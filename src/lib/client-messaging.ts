import "server-only";
import type { OrgScope } from "@/db/scoped";
import { sendEmail, sendSms } from "@/lib/messaging";

/**
 * Client-facing sends (M5): the layer that knows the recipient is a CLIENT —
 * so it owns channel resolution, SMS consent (client.sms_opt_out_at), the
 * `message` send-log row, and the contact-timeline entry. Mass send,
 * reminders, and any future one-off client message all come through here;
 * raw sendEmail/sendSms stay for non-client mail (invites, OTPs).
 *
 * A skipped send (opt-out, no usable address) still writes a message row —
 * status 'skipped' with the reason — so batches account for every recipient.
 */

export type ClientRecipient = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  preferredChannel: "email" | "sms" | "phone" | "mail";
  smsOptOutAt: Date | null;
};

export type ChannelChoice = "preferred" | "email" | "sms";

export type ChannelResolution =
  | { ok: true; channel: "email" | "sms"; to: string }
  | { ok: false; skipReason: "sms_opt_out" | "no_address" };

/**
 * Pick the concrete channel + address for one client. 'preferred' follows
 * preferred_channel where it names a digital channel and falls back to the
 * other one; phone/mail preferences fall back to email-then-SMS. An SMS is
 * only ever chosen when the client has a phone AND has not opted out.
 */
export function resolveChannel(client: ClientRecipient, requested: ChannelChoice): ChannelResolution {
  const smsOk = !!client.phone && !client.smsOptOutAt;
  const emailOk = !!client.email;

  if (requested === "sms") {
    if (!client.phone) return { ok: false, skipReason: "no_address" };
    return smsOk
      ? { ok: true, channel: "sms", to: client.phone }
      : { ok: false, skipReason: "sms_opt_out" };
  }
  if (requested === "email") {
    return emailOk
      ? { ok: true, channel: "email", to: client.email! }
      : { ok: false, skipReason: "no_address" };
  }

  const order: Array<"email" | "sms"> =
    client.preferredChannel === "sms" ? ["sms", "email"] : ["email", "sms"];
  for (const channel of order) {
    if (channel === "email" && emailOk) return { ok: true, channel, to: client.email! };
    if (channel === "sms" && smsOk) return { ok: true, channel, to: client.phone! };
  }
  // Nothing usable: name the consent block only when it was the sole blocker.
  return {
    ok: false,
    skipReason: !emailOk && client.phone && client.smsOptOutAt ? "sms_opt_out" : "no_address",
  };
}

export type ClientSendInput = {
  client: ClientRecipient;
  engagementId?: string | null;
  templateId?: string | null;
  batchId?: string | null;
  kind: "manual" | "mass" | "reminder";
  requestedChannel: ChannelChoice;
  /** Rendered per-recipient before this call (src/lib/templates.ts). */
  subject?: string | null;
  body: string;
  /** Contact-timeline line, e.g. `Sent "Missing documents reminder"`. */
  contactSummary: string;
};

/**
 * Resolve → consent-check → message row → outbox/provider → contact log.
 * Returns the final message row; never throws on delivery failure (the row
 * carries status=failed + error instead).
 */
export async function sendClientMessage(scope: OrgScope, input: ClientSendInput) {
  const resolution = resolveChannel(input.client, input.requestedChannel);

  if (!resolution.ok) {
    return scope.createMessage({
      clientId: input.client.id,
      engagementId: input.engagementId ?? null,
      templateId: input.templateId ?? null,
      batchId: input.batchId ?? null,
      kind: input.kind,
      // Log the intended channel so a skipped row reads sensibly.
      channel: input.requestedChannel === "email" ? "email" : "sms",
      toAddress: input.client.phone ?? input.client.email ?? "",
      subject: input.subject ?? null,
      body: input.body,
      status: "skipped",
      skipReason: resolution.skipReason,
    });
  }

  const message = await scope.createMessage({
    clientId: input.client.id,
    engagementId: input.engagementId ?? null,
    templateId: input.templateId ?? null,
    batchId: input.batchId ?? null,
    kind: input.kind,
    channel: resolution.channel,
    toAddress: resolution.to,
    subject: resolution.channel === "email" ? (input.subject ?? null) : null,
    body: input.body,
    status: "queued",
  });

  return deliverQueuedMessage(scope, message, input.contactSummary);
}

type MessageRow = Awaited<ReturnType<OrgScope["createMessage"]>>;

/**
 * Transport step for an existing queued message row: outbox/provider →
 * status flip → contact-timeline entry on success. Mass sends create their
 * rows up front and run this from the message-send job worker; inline sends
 * (reminders) arrive via sendClientMessage above. No-op unless queued.
 */
export async function deliverQueuedMessage(
  scope: OrgScope,
  message: MessageRow,
  contactSummary: string
): Promise<MessageRow> {
  if (message.status !== "queued") return message;

  const outboxRow =
    message.channel === "email"
      ? await sendEmail(scope, {
          to: message.toAddress,
          subject: message.subject ?? "",
          body: message.body,
          meta: { messageId: message.id, kind: message.kind },
        })
      : await sendSms(scope, {
          to: message.toAddress,
          body: message.body,
          meta: { messageId: message.id, kind: message.kind },
        });

  const delivered = outboxRow.status === "sent";
  const updated =
    (await scope.updateMessage(message.id, {
      outboxId: outboxRow.id,
      status: delivered ? "sent" : "failed",
      error: delivered ? null : outboxRow.error,
      sentAt: delivered ? new Date() : null,
    })) ?? message;

  if (delivered) {
    await scope.addContactLog({
      clientId: message.clientId,
      channel: message.channel,
      summary: contactSummary,
    });
  }
  return updated;
}
