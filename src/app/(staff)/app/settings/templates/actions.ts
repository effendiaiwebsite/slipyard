"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError, type Action } from "@/lib/permissions";
import { findUnknownVariables } from "@/lib/templates";

/**
 * Settings → Templates (M5): template CRUD gated by
 * messages.manage_templates; the reminder policy card writes org.settings
 * and is gated by org.update_settings. Both are owner/admin in the matrix,
 * but they stay separate actions so the matrix remains the single source.
 */

type ActionResult = { error?: string; ok?: boolean };

async function guard(
  action: Action,
  resourceType = "message_template"
): Promise<{ ctx: Awaited<ReturnType<typeof requireStaff>> } | { error: string }> {
  const ctx = await requireStaff();
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      action,
      { orgId: ctx.orgId, type: resourceType },
      { readOnlyOrg: ctx.readOnly }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }
  return { ctx };
}

function refresh() {
  revalidatePath("/app/settings/templates");
  revalidatePath("/app/messages");
}

const templateSchema = z.object({
  name: z.string().trim().min(2, "Name the template").max(80),
  channel: z.enum(["email", "sms"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5, "Write the message body").max(4000),
});

function validateVariables(body: string, subject?: string): string | null {
  const unknown = findUnknownVariables(`${subject ?? ""}\n${body}`);
  if (unknown.length > 0) {
    return `Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((v) => `{${v}}`).join(", ")}`;
  }
  return null;
}

export async function createTemplate(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const g = await guard("messages.manage_templates");
  if ("error" in g) return g;
  const parsed = templateSchema.safeParse({
    name: formData.get("name"),
    channel: formData.get("channel"),
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const varError = validateVariables(parsed.data.body, parsed.data.subject);
  if (varError) return { error: varError };

  const existing = await g.ctx.scope.listMessageTemplates();
  if (existing.some((t) => t.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    return { error: "A template with that name already exists." };
  }
  await g.ctx.scope.createMessageTemplate({
    name: parsed.data.name,
    channel: parsed.data.channel,
    subject: parsed.data.channel === "email" ? (parsed.data.subject ?? null) : null,
    body: parsed.data.body,
  });
  refresh();
  return { ok: true };
}

export async function updateTemplate(
  templateId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const g = await guard("messages.manage_templates");
  if ("error" in g) return g;
  if (!z.string().uuid().safeParse(templateId).success) return { error: "Invalid template" };
  const current = await g.ctx.scope.getMessageTemplate(templateId);
  if (!current) return { error: "Template not found" };

  const parsed = templateSchema.safeParse({
    name: formData.get("name"),
    channel: current.channel, // channel is fixed after creation
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const varError = validateVariables(parsed.data.body, parsed.data.subject);
  if (varError) return { error: varError };

  const existing = await g.ctx.scope.listMessageTemplates();
  if (
    existing.some(
      (t) => t.id !== templateId && t.name.toLowerCase() === parsed.data.name.toLowerCase()
    )
  ) {
    return { error: "A template with that name already exists." };
  }
  await g.ctx.scope.updateMessageTemplate(templateId, {
    name: parsed.data.name,
    subject: current.channel === "email" ? (parsed.data.subject ?? null) : null,
    body: parsed.data.body,
  });
  refresh();
  return { ok: true };
}

export async function setTemplateArchived(
  templateId: string,
  archived: boolean
): Promise<ActionResult> {
  const g = await guard("messages.manage_templates");
  if ("error" in g) return g;
  if (!z.string().uuid().safeParse(templateId).success) return { error: "Invalid template" };
  const updated = await g.ctx.scope.updateMessageTemplate(templateId, {
    archivedAt: archived ? new Date() : null,
  });
  if (!updated) return { error: "Template not found" };
  refresh();
  return { ok: true };
}

const reminderSchema = z.object({
  enabled: z.boolean(),
  awaiting_docs_days: z.coerce.number().int().min(0, "Days can't be negative").max(365),
  cadence_days: z.coerce.number().int().min(1, "Wait at least a day between nudges").max(365),
  channel: z.enum(["preferred", "email", "sms"]),
  template_id: z.string().uuid().nullable(),
});

export async function saveReminderPolicy(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const g = await guard("org.update_settings", "org");
  if ("error" in g) return g;
  const parsed = reminderSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    awaiting_docs_days: formData.get("awaiting_docs_days"),
    cadence_days: formData.get("cadence_days"),
    channel: formData.get("channel"),
    template_id: formData.get("template_id") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (parsed.data.template_id) {
    const template = await g.ctx.scope.getMessageTemplate(parsed.data.template_id);
    if (!template || template.archivedAt) return { error: "Pick an active template." };
  }
  await g.ctx.scope.updateOrgSettings({ reminders: parsed.data });
  refresh();
  return { ok: true };
}
