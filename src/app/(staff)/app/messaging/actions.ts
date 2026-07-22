"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverQueuedMessage, resolveChannel } from "@/lib/client-messaging";
import { requireStaff } from "@/lib/context";
import { enqueueMessageSend } from "@/lib/jobs";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import { buildTemplateVars, renderTemplate } from "@/lib/templates";

/**
 * Mass send (M5): filtered client list → one template → per-recipient
 * message rows (rendered per client) → transport via message-send jobs.
 * The rows are created synchronously so the batch is fully accounted for
 * the moment the action returns (skips included); only delivery is async.
 * Gated by messages.send_templated (clerks allowed — front-desk reminders).
 */

const inputSchema = z.object({
  templateId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).min(1, "Pick at least one client").max(500),
});

export type MassSendResult = {
  error?: string;
  ok?: boolean;
  queued?: number;
  skipped?: number;
};

export async function sendMassMessage(
  templateId: string,
  clientIds: string[]
): Promise<MassSendResult> {
  const parsed = inputSchema.safeParse({ templateId, clientIds });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await requireStaff();
  const template = await ctx.scope.getMessageTemplate(parsed.data.templateId);
  if (!template || template.archivedAt) return { error: "Pick an active template." };

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "messages.send_templated",
      { orgId: ctx.orgId, type: "message_template", id: template.id },
      {
        readOnlyOrg: ctx.readOnly,
        orgSettings: ctx.orgSettings,
        details: { op: "mass_send", recipients: parsed.data.clientIds.length },
      }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }

  // Resolve recipients inside the org scope; unknown/archived ids drop out.
  const all = await ctx.scope.listClientsWithMeta({ status: "active" });
  const wanted = new Set(parsed.data.clientIds);
  const recipients = all.filter((r) => wanted.has(r.client.id));
  if (recipients.length === 0) return { error: "None of those clients were found." };

  // {missing_docs} per client = required, still-missing items of their
  // LATEST engagement (the one the grid shows).
  const missingByEngagement = new Map<string, string[]>();
  for (const item of await ctx.scope.listMissingChecklistItems()) {
    if (!item.required) continue;
    const list = missingByEngagement.get(item.engagementId) ?? [];
    list.push(item.title);
    missingByEngagement.set(item.engagementId, list);
  }

  const batchId = crypto.randomUUID();
  let queued = 0;
  let skipped = 0;

  for (const r of recipients) {
    const engagement = r.latestEngagement?.engagement ?? null;
    const vars = buildTemplateVars({
      clientName: r.client.displayName,
      firmName: ctx.orgName,
      taxYear: engagement?.taxYear,
      missingDocs: engagement ? (missingByEngagement.get(engagement.id) ?? []) : [],
      accountantName: r.assignedName,
    });
    const body = renderTemplate(template.body, vars).text;
    const subject = template.subject ? renderTemplate(template.subject, vars).text : null;

    const resolution = resolveChannel(r.client, template.channel);
    if (!resolution.ok) {
      skipped++;
      await ctx.scope.createMessage({
        clientId: r.client.id,
        engagementId: engagement?.id ?? null,
        templateId: template.id,
        batchId,
        kind: "mass",
        channel: template.channel,
        toAddress: r.client.phone ?? r.client.email ?? "",
        subject,
        body,
        status: "skipped",
        skipReason: resolution.skipReason,
      });
      continue;
    }

    const message = await ctx.scope.createMessage({
      clientId: r.client.id,
      engagementId: engagement?.id ?? null,
      templateId: template.id,
      batchId,
      kind: "mass",
      channel: resolution.channel,
      toAddress: resolution.to,
      subject: resolution.channel === "email" ? subject : null,
      body,
      status: "queued",
    });
    queued++;
    // Transport through the job runner; inline fallback keeps job-less
    // contexts (JOBS_ENABLED=false, tests) working.
    if (!(await enqueueMessageSend({ orgId: ctx.orgId, messageId: message.id }))) {
      await deliverQueuedMessage(ctx.scope, message, `Sent "${template.name}".`);
    }
  }

  await ctx.scope.writeAudit({
    actorType: "staff",
    action: "messages.mass_send",
    resourceType: "message_template",
    resourceId: template.id,
    details: { batchId, queued, skipped },
  });

  revalidatePath("/app/messaging");
  return { ok: true, queued, skipped };
}
