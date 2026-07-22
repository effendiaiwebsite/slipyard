import "server-only";
import { OrgScope } from "@/db/scoped";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deliverEmail, deliverSms } from "@/lib/message-providers";

/**
 * Outbound messaging, outbox pattern (§1): every email/SMS lands in the
 * org-scoped `outbox` table FIRST, then the configured adapter delivers it
 * and flips the row to sent/failed.
 *
 * Dev mode (EMAIL_MODE=outbox / no Twilio keys) "delivers" to the console +
 * table so every flow is testable offline — this stays the default. Real
 * adapters (M5): EMAIL_MODE=ses → SES; TWILIO_* set → Twilio REST. A failed
 * provider call leaves an outbox row with status=failed and the error —
 * never a silent drop, never a retry here (SMS/email sends aren't
 * idempotent; humans retry from the UI).
 *
 * NEVER log message bodies (they carry invite/magic links + OTPs) — ids only.
 *
 * Consent note: SMS opt-out (client.sms_opt_out_at) is enforced in
 * src/lib/client-messaging.ts — the layer that knows the recipient is a
 * client. This layer also serves staff invites and portal OTPs, which are
 * not marketing and go to whoever staff addressed.
 */

export async function sendEmail(
  scope: OrgScope,
  msg: { to: string; subject: string; body: string; meta?: Record<string, unknown> }
) {
  if (env.EMAIL_MODE !== "ses") {
    if (env.EMAIL_MODE === "smtp") {
      // SES is the supported real adapter; SMTP remains a stub (DECISIONS).
      logger.warn("EMAIL_MODE=smtp has no adapter — delivering to outbox/console");
    }
    const row = await scope.createOutbox({
      channel: "email",
      toAddress: msg.to,
      subject: msg.subject,
      body: msg.body,
      provider: "console",
      status: "sent",
      meta: msg.meta,
    });
    console.log(`\n[outbox:email] to=${msg.to} subject="${msg.subject}"\n${msg.body}\n`);
    logger.info({ outboxId: row.id, channel: "email", provider: "console" }, "message delivered to outbox");
    return row;
  }

  let row = await scope.createOutbox({
    channel: "email",
    toAddress: msg.to,
    subject: msg.subject,
    body: msg.body,
    provider: "ses",
    status: "queued",
    meta: msg.meta,
  });
  const result = await deliverEmail(msg.to, msg.subject, msg.body);
  row =
    (await scope.updateOutbox(
      row.id,
      result.ok
        ? { status: "sent", providerMessageId: result.providerMessageId, sentAt: new Date() }
        : { status: "failed", error: result.error }
    )) ?? row;
  if (result.ok) {
    logger.info({ outboxId: row.id, channel: "email", provider: "ses" }, "email sent");
  } else {
    logger.warn({ outboxId: row.id, channel: "email", error: result.error }, "email send failed");
  }
  return row;
}

export async function sendSms(
  scope: OrgScope,
  msg: { to: string; body: string; meta?: Record<string, unknown> }
) {
  if (!features.realSms) {
    const row = await scope.createOutbox({
      channel: "sms",
      toAddress: msg.to,
      body: msg.body,
      provider: "console",
      status: "sent",
      meta: msg.meta,
    });
    console.log(`\n[outbox:sms] to=${msg.to}\n${msg.body}\n`);
    logger.info({ outboxId: row.id, channel: "sms", provider: "console" }, "message delivered to outbox");
    return row;
  }

  let row = await scope.createOutbox({
    channel: "sms",
    toAddress: msg.to,
    body: msg.body,
    provider: "twilio",
    status: "queued",
    meta: msg.meta,
  });
  const result = await deliverSms(msg.to, msg.body);
  row =
    (await scope.updateOutbox(
      row.id,
      result.ok
        ? { status: "sent", providerMessageId: result.providerMessageId, sentAt: new Date() }
        : { status: "failed", error: result.error }
    )) ?? row;
  if (result.ok) {
    logger.info({ outboxId: row.id, channel: "sms", provider: "twilio" }, "sms sent");
  } else {
    logger.warn({ outboxId: row.id, channel: "sms", error: result.error }, "sms send failed");
  }
  return row;
}
