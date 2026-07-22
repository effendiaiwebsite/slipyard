"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applyAutoAdvance, instantiateChecklist } from "@/lib/checklists";
import { requireStaff, type StaffContext } from "@/lib/context";
import { encryptField, isValidSin } from "@/lib/crypto";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * Client-hub mutations (M2). Every one: requireStaff → zod → authorize()
 * (which audits) → OrgScope. SIN never leaves this file unencrypted and is
 * never echoed back in errors or logs.
 */

type ActionResult = { error?: string; ok?: boolean; clientId?: string };

/**
 * authorize(), but denials come back as a message for the form/board UI
 * instead of an unhandled throw (the denial is still audited). Tenancy
 * violations keep failing loudly.
 */
async function tryAuthorize(...args: Parameters<typeof authorize>): Promise<string | null> {
  try {
    await authorize(...args);
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const clientFieldsSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  type: z.enum(["individual", "corporation", "trust"]),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+1\d{10}$/, "Phone must be E.164 Canadian format, e.g. +14165551234")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .optional(),
  preferredChannel: z.enum(["email", "sms", "phone", "mail"]),
  addressLine1: optional(200),
  city: optional(100),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Province must be a 2-letter code, e.g. ON")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .optional(),
  postalCode: optional(10),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .optional(),
  // Raw SIN only ever exists inside this request; blank = leave unchanged.
  sin: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .optional(),
  assignedAccountantId: optional(64),
  householdId: z.string().uuid().or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  newHouseholdName: optional(120),
  tags: z
    .string()
    .trim()
    .max(500)
    .transform((v) =>
      v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    )
    .optional(),
});

function clientFieldsFromForm(formData: FormData) {
  const get = (k: string) => (formData.get(k) as string | null) ?? "";
  return clientFieldsSchema.safeParse({
    displayName: get("displayName"),
    type: get("type"),
    email: get("email"),
    phone: get("phone"),
    preferredChannel: get("preferredChannel"),
    addressLine1: get("addressLine1"),
    city: get("city"),
    province: get("province"),
    postalCode: get("postalCode"),
    dateOfBirth: get("dateOfBirth"),
    sin: get("sin"),
    assignedAccountantId: get("assignedAccountantId"),
    householdId: get("householdId"),
    newHouseholdName: get("newHouseholdName"),
    tags: get("tags"),
  });
}

/** Validate an (optional) assignee: must be an active, non-clerk member. */
async function checkAssignee(ctx: StaffContext, userId: string | null | undefined) {
  if (!userId) return null;
  const membership = await ctx.scope.getMembership(userId);
  if (!membership || membership.status !== "active" || membership.role === "clerk") {
    return "Assignee must be an active staff member who isn't a clerk.";
  }
  return null;
}

/** SIN prep: validates + encrypts. Returns update fields or an error. */
function sinFields(sinRaw: string | undefined):
  | { error: string }
  | { sinEncrypted?: string; sinLast3?: string } {
  if (!sinRaw) return {};
  if (!isValidSin(sinRaw)) return { error: "That SIN is not valid (9 digits, checksum failed)." };
  return { sinEncrypted: encryptField(sinRaw), sinLast3: sinRaw.slice(-3) };
}

async function resolveHousehold(
  ctx: StaffContext,
  householdId: string | null | undefined,
  newHouseholdName: string | null | undefined
): Promise<string | null> {
  if (newHouseholdName) {
    const created = await ctx.scope.createHousehold(newHouseholdName);
    return created.id;
  }
  return householdId ?? null;
}

export async function createClient(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = clientFieldsFromForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const f = parsed.data;

  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.create",
    { orgId: ctx.orgId, type: "client" },
    { readOnlyOrg: ctx.readOnly }
  );
  if (denied) return { error: denied };

  const assigneeProblem = await checkAssignee(ctx, f.assignedAccountantId);
  if (assigneeProblem) return { error: assigneeProblem };
  const sin = sinFields(f.sin);
  if ("error" in sin) return { error: sin.error };

  const created = await ctx.scope.createClient({
    displayName: f.displayName,
    type: f.type,
    email: f.email ?? null,
    phone: f.phone ?? null,
    preferredChannel: f.preferredChannel,
    addressLine1: f.addressLine1 ?? null,
    city: f.city ?? null,
    province: f.province ?? null,
    postalCode: f.postalCode ?? null,
    dateOfBirth: f.dateOfBirth ?? null,
    ...sin,
    assignedAccountantId: f.assignedAccountantId ?? null,
    householdId: await resolveHousehold(ctx, f.householdId, f.newHouseholdName),
    tags: f.tags ?? [],
    createdBy: ctx.user.id,
  });

  revalidatePath("/app/clients");
  return { ok: true, clientId: created.id };
}

export async function updateClient(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(clientId).success) return { error: "Invalid client" };
  const parsed = clientFieldsFromForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const f = parsed.data;

  const existing = await ctx.scope.getClient(clientId);
  if (!existing) return { error: "Client not found" };

  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings }
  );
  if (denied) return { error: denied };

  const assigneeProblem = await checkAssignee(ctx, f.assignedAccountantId);
  if (assigneeProblem) return { error: assigneeProblem };
  const sin = sinFields(f.sin);
  if ("error" in sin) return { error: sin.error };

  await ctx.scope.updateClient(clientId, {
    displayName: f.displayName,
    type: f.type,
    email: f.email ?? null,
    phone: f.phone ?? null,
    preferredChannel: f.preferredChannel,
    addressLine1: f.addressLine1 ?? null,
    city: f.city ?? null,
    province: f.province ?? null,
    postalCode: f.postalCode ?? null,
    dateOfBirth: f.dateOfBirth ?? null,
    ...sin, // blank SIN input leaves the stored value untouched
    assignedAccountantId: f.assignedAccountantId ?? null,
    householdId: await resolveHousehold(ctx, f.householdId, f.newHouseholdName),
    tags: f.tags ?? [],
  });

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, clientId };
}

export async function setClientStatus(
  clientId: string,
  status: "active" | "archived"
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(clientId).success) return { error: "Invalid client" };
  const existing = await ctx.scope.getClient(clientId);
  if (!existing) return { error: "Client not found" };
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "set_status", status } }
  );
  if (denied) return { error: denied };
  await ctx.scope.updateClient(clientId, { status });
  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

// ---- notes & contact log -----------------------------------------------------

const noteSchema = z.object({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  pinned: z.boolean(),
});

export async function addNote(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = noteSchema.safeParse({
    clientId,
    body: formData.get("body"),
    pinned: formData.get("pinned") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await ctx.scope.getClient(parsed.data.clientId);
  if (!existing) return { error: "Client not found" };
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "add_note" } }
  );
  if (denied) return { error: denied };

  await ctx.scope.addClientNote(parsed.data);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function setNotePinned(
  clientId: string,
  noteId: string,
  pinned: boolean
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(noteId).success) return { error: "Invalid note" };
  const existing = await ctx.scope.getClient(clientId);
  if (!existing) return { error: "Client not found" };
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "pin_note", pinned } }
  );
  if (denied) return { error: denied };
  await ctx.scope.setNotePinned(noteId, pinned);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

const contactSchema = z.object({
  clientId: z.string().uuid(),
  channel: z.enum(["phone", "email", "sms", "meeting", "mail", "other"]),
  summary: z.string().trim().min(1).max(2000),
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .optional(),
});

export async function addContactLogEntry(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = contactSchema.safeParse({
    clientId,
    channel: formData.get("channel"),
    summary: formData.get("summary"),
    occurredAt: formData.get("occurredAt") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await ctx.scope.getClient(parsed.data.clientId);
  if (!existing) return { error: "Client not found" };
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "log_contact", channel: parsed.data.channel } }
  );
  if (denied) return { error: denied };

  await ctx.scope.addContactLog({
    clientId: parsed.data.clientId,
    channel: parsed.data.channel,
    summary: parsed.data.summary,
    occurredAt: parsed.data.occurredAt ? new Date(`${parsed.data.occurredAt}T12:00:00`) : undefined,
  });
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

// ---- engagements -------------------------------------------------------------

const engagementSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["t1", "t2", "t3", "other"]),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  assignedToId: optional(64),
});

export async function createEngagement(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = engagementSchema.safeParse({
    clientId,
    type: formData.get("type"),
    taxYear: formData.get("taxYear"),
    assignedToId: (formData.get("assignedToId") as string | null) ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await ctx.scope.getClient(parsed.data.clientId);
  if (!existing) return { error: "Client not found" };
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "engagements.create",
    { orgId: existing.orgId, type: "client", id: clientId, assignedTo: existing.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, details: { type: parsed.data.type, taxYear: parsed.data.taxYear } }
  );
  if (denied) return { error: denied };

  const assigneeProblem = await checkAssignee(ctx, parsed.data.assignedToId);
  if (assigneeProblem) return { error: assigneeProblem };

  // New engagements enter the org's first stage (whatever the firm calls it).
  const stages = await ctx.scope.listStages();
  if (stages.length === 0) return { error: "No workflow stages configured. Add stages in Settings first." };

  const engagement = await ctx.scope.createEngagement({
    clientId: parsed.data.clientId,
    type: parsed.data.type,
    taxYear: parsed.data.taxYear,
    stageId: stages[0].id,
    // Default to the client's accountant so the personal board picks it up.
    assignedToId: parsed.data.assignedToId ?? existing.assignedAccountantId,
  });
  // M3: every new engagement gets its type's document checklist, and the
  // auto-advance rules may immediately move it to an awaiting-docs stage.
  await instantiateChecklist(ctx.scope, engagement.id, engagement.type);
  await applyAutoAdvance(ctx.scope, engagement.id);
  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/workflow");
  return { ok: true };
}

const transitionSchema = z.object({
  engagementId: z.string().uuid(),
  stageId: z.string().uuid(),
});

export async function transitionEngagement(
  engagementId: string,
  stageId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = transitionSchema.safeParse({ engagementId, stageId });
  if (!parsed.success) return { error: "Invalid transition" };

  const engagement = await ctx.scope.getEngagement(parsed.data.engagementId);
  if (!engagement) return { error: "Engagement not found" };
  // Stage must belong to this org — getStage is org-scoped, so a foreign id
  // simply doesn't resolve.
  const stage = await ctx.scope.getStage(parsed.data.stageId);
  if (!stage) return { error: "Stage not found" };

  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "engagements.transition",
    {
      orgId: engagement.orgId,
      type: "engagement",
      id: engagement.id,
      assignedTo: engagement.assignedToId,
    },
    {
      readOnlyOrg: ctx.readOnly,
      details: { fromStageId: engagement.stageId, toStage: stage.key },
    }
  );
  if (denied) return { error: denied };

  if (engagement.stageId !== parsed.data.stageId) {
    await ctx.scope.transitionEngagement(parsed.data.engagementId, parsed.data.stageId);
  }
  revalidatePath("/app/workflow");
  revalidatePath(`/app/clients/${engagement.clientId}`);
  return { ok: true };
}

export async function assignEngagement(
  engagementId: string,
  assignedToId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(engagementId).success) return { error: "Invalid engagement" };

  const engagement = await ctx.scope.getEngagement(engagementId);
  if (!engagement) return { error: "Engagement not found" };
  const client = await ctx.scope.getClient(engagement.clientId);

  // Reassignment is a client-data edit: owner/admin anywhere, accountant on
  // their own clients (they may hand work off), clerks never.
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "clients.update",
    {
      orgId: engagement.orgId,
      type: "engagement",
      id: engagement.id,
      assignedTo: engagement.assignedToId ?? client?.assignedAccountantId,
    },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "assign_engagement" } }
  );
  if (denied) return { error: denied };

  const target = assignedToId || null;
  const assigneeProblem = await checkAssignee(ctx, target);
  if (assigneeProblem) return { error: assigneeProblem };

  await ctx.scope.updateEngagement(engagementId, { assignedToId: target });
  revalidatePath("/app/workflow");
  revalidatePath(`/app/clients/${engagement.clientId}`);
  return { ok: true };
}
