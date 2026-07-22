"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applyAutoAdvance, instantiateChecklist } from "@/lib/checklists";
import { requireStaff, type StaffContext } from "@/lib/context";
import { scanAndRouteDocument } from "@/lib/documents";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import { deleteObject, presignDownloadUrl } from "@/lib/storage";

/**
 * Vault & checklist mutations (M3). Same discipline as the client hub:
 * requireStaff → zod → authorize() (audited) → OrgScope. Checklist state
 * changes end with applyAutoAdvance (category-keyed, ADR-0015).
 */

type ActionResult = {
  error?: string;
  ok?: boolean;
  /** Stage label when the change auto-advanced the engagement. */
  autoAdvancedTo?: string;
  /** Presigned URL (5 min) for download actions. */
  url?: string;
};

async function tryAuthorize(...args: Parameters<typeof authorize>): Promise<string | null> {
  try {
    await authorize(...args);
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

const uuid = z.string().uuid();

/**
 * documents.manage on an engagement: owner/admin anywhere, accountant on
 * engagements assigned to them (falling back to the client's accountant),
 * clerks never.
 */
async function authorizeManage(
  ctx: StaffContext,
  engagement: { id: string; orgId: string; clientId: string; assignedToId: string | null },
  details: Record<string, unknown>
): Promise<string | null> {
  const client = await ctx.scope.getClient(engagement.clientId);
  return tryAuthorize(
    ctx.scope,
    ctx.actor,
    "documents.manage",
    {
      orgId: engagement.orgId,
      type: "engagement",
      id: engagement.id,
      assignedTo: engagement.assignedToId ?? client?.assignedAccountantId,
    },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details }
  );
}

function revalidateDocViews(clientId?: string) {
  revalidatePath("/app/tax");
  revalidatePath("/app/tax/intake");
  if (clientId) revalidatePath(`/app/clients/${clientId}`);
}

// ---- documents ---------------------------------------------------------------

/**
 * File an intake document against an engagement, optionally satisfying a
 * checklist item. Only clean documents can be filed.
 */
export async function assignDocument(
  documentId: string,
  engagementId: string,
  checklistItemId?: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(documentId).success || !uuid.safeParse(engagementId).success) {
    return { error: "Invalid selection" };
  }

  const doc = await ctx.scope.getDocument(documentId);
  if (!doc) return { error: "Document not found" };
  if (doc.status !== "clean") {
    return { error: "Only scanned-clean documents can be filed against a return." };
  }
  const engagement = await ctx.scope.getEngagement(engagementId);
  if (!engagement || engagement.clientId !== doc.clientId) {
    return { error: "Engagement not found for this client" };
  }
  const item = checklistItemId ? await ctx.scope.getChecklistItem(checklistItemId) : null;
  if (checklistItemId && (!item || item.engagementId !== engagementId)) {
    return { error: "Checklist item not found on this engagement" };
  }

  const denied = await authorizeManage(ctx, engagement, {
    op: "assign_document",
    documentId,
    checklistItemId,
  });
  if (denied) return { error: denied };

  await ctx.scope.updateDocument(documentId, { engagementId });
  if (item) {
    await ctx.scope.updateChecklistItem(item.id, { status: "received", documentId });
  }
  const advance = await applyAutoAdvance(ctx.scope, engagementId);

  revalidateDocViews(doc.clientId);
  revalidatePath("/app/workflow");
  return { ok: true, autoAdvancedTo: advance.moved ? advance.toStageLabel : undefined };
}

/** 5-minute presigned GET for a clean document. Audited as documents.view. */
export async function getDownloadUrl(documentId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(documentId).success) return { error: "Invalid document" };

  const doc = await ctx.scope.getDocument(documentId);
  if (!doc) return { error: "Document not found" };
  if (doc.status !== "clean") {
    return { error: "This file hasn't passed the virus scan, so it can't be downloaded." };
  }
  const client = await ctx.scope.getClient(doc.clientId);

  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "documents.view",
    {
      orgId: doc.orgId,
      type: "document",
      id: doc.id,
      assignedTo: client?.assignedAccountantId,
    },
    { orgSettings: ctx.orgSettings, details: { op: "download" } }
  );
  if (denied) return { error: denied };

  const url = await presignDownloadUrl(doc.s3Key, doc.filename, doc.contentType);
  return { ok: true, url };
}

/** Retry the scan for a scan_failed document (e.g. scanner was down). */
export async function rescanDocument(documentId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(documentId).success) return { error: "Invalid document" };

  const doc = await ctx.scope.getDocument(documentId);
  if (!doc) return { error: "Document not found" };
  if (doc.status !== "scan_failed") return { error: "Only failed scans can be retried." };

  const client = await ctx.scope.getClient(doc.clientId);
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "documents.manage",
    { orgId: doc.orgId, type: "document", id: doc.id, assignedTo: client?.assignedAccountantId },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details: { op: "rescan" } }
  );
  if (denied) return { error: denied };

  const updated = await ctx.scope.updateDocument(documentId, { status: "pending_scan" });
  await scanAndRouteDocument(ctx.scope, updated ?? doc);
  revalidateDocViews(doc.clientId);
  return { ok: true };
}

/** Remove an infected or unscannable document (S3 object + row). */
export async function deleteDocument(documentId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(documentId).success) return { error: "Invalid document" };

  const doc = await ctx.scope.getDocument(documentId);
  if (!doc) return { error: "Document not found" };
  if (doc.status === "clean") {
    // Vault documents are retained (7-year posture) — no delete path until
    // the M9 retention review flow.
    return { error: "Vault documents can't be deleted. Only quarantined files can be removed." };
  }

  const client = await ctx.scope.getClient(doc.clientId);
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "documents.manage",
    { orgId: doc.orgId, type: "document", id: doc.id, assignedTo: client?.assignedAccountantId },
    {
      readOnlyOrg: ctx.readOnly,
      orgSettings: ctx.orgSettings,
      details: { op: "delete_document", status: doc.status },
    }
  );
  if (denied) return { error: denied };

  if (doc.s3Key) await deleteObject(doc.s3Key);
  await ctx.scope.deleteDocument(documentId);
  revalidateDocViews(doc.clientId);
  return { ok: true };
}

// ---- checklists ----------------------------------------------------------------

/** Create the template checklist for an engagement that doesn't have one. */
export async function generateChecklist(engagementId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(engagementId).success) return { error: "Invalid engagement" };

  const engagement = await ctx.scope.getEngagement(engagementId);
  if (!engagement) return { error: "Engagement not found" };

  const denied = await authorizeManage(ctx, engagement, { op: "generate_checklist" });
  if (denied) return { error: denied };

  await instantiateChecklist(ctx.scope, engagementId, engagement.type);
  const advance = await applyAutoAdvance(ctx.scope, engagementId);
  revalidateDocViews(engagement.clientId);
  revalidatePath("/app/workflow");
  return { ok: true, autoAdvancedTo: advance.moved ? advance.toStageLabel : undefined };
}

const itemStatusSchema = z.enum(["missing", "received", "waived"]);

/**
 * Manual checklist state change (paper handed over at the desk, item waived,
 * or walked back to missing). Detaches the linked document when leaving
 * 'received'.
 */
export async function setChecklistItemStatus(
  itemId: string,
  status: "missing" | "received" | "waived"
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(itemId).success || !itemStatusSchema.safeParse(status).success) {
    return { error: "Invalid item" };
  }

  const item = await ctx.scope.getChecklistItem(itemId);
  if (!item) return { error: "Checklist item not found" };
  const engagement = await ctx.scope.getEngagement(item.engagementId);
  if (!engagement) return { error: "Engagement not found" };

  const denied = await authorizeManage(ctx, engagement, {
    op: "set_checklist_status",
    itemId,
    status,
  });
  if (denied) return { error: denied };

  await ctx.scope.updateChecklistItem(itemId, {
    status,
    ...(status === "received" ? {} : { documentId: null }),
  });
  const advance = await applyAutoAdvance(ctx.scope, item.engagementId);

  revalidateDocViews(engagement.clientId);
  revalidatePath("/app/workflow");
  return { ok: true, autoAdvancedTo: advance.moved ? advance.toStageLabel : undefined };
}

const addItemSchema = z.object({
  engagementId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  required: z.boolean(),
});

/** Add a custom item (e.g. "Signed engagement letter") to one engagement. */
export async function addChecklistItem(
  engagementId: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = addItemSchema.safeParse({
    engagementId,
    title: formData.get("title"),
    required: formData.get("required") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const engagement = await ctx.scope.getEngagement(parsed.data.engagementId);
  if (!engagement) return { error: "Engagement not found" };

  const denied = await authorizeManage(ctx, engagement, {
    op: "add_checklist_item",
    title: parsed.data.title,
  });
  if (denied) return { error: denied };

  await ctx.scope.addChecklistItem(parsed.data.engagementId, parsed.data.title, parsed.data.required);
  // A new required item can pull the engagement back into awaiting-docs
  // territory only via the normal rules (it never moves work backwards).
  const advance = await applyAutoAdvance(ctx.scope, parsed.data.engagementId);
  revalidateDocViews(engagement.clientId);
  return { ok: true, autoAdvancedTo: advance.moved ? advance.toStageLabel : undefined };
}

/** Remove a checklist item (typo, duplicate, not applicable). */
export async function removeChecklistItem(itemId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(itemId).success) return { error: "Invalid item" };

  const item = await ctx.scope.getChecklistItem(itemId);
  if (!item) return { error: "Checklist item not found" };
  const engagement = await ctx.scope.getEngagement(item.engagementId);
  if (!engagement) return { error: "Engagement not found" };

  const denied = await authorizeManage(ctx, engagement, {
    op: "remove_checklist_item",
    itemId,
    title: item.title,
  });
  if (denied) return { error: denied };

  await ctx.scope.deleteChecklistItem(itemId);
  // Removing the last missing required item can complete the checklist.
  const advance = await applyAutoAdvance(ctx.scope, item.engagementId);
  revalidateDocViews(engagement.clientId);
  revalidatePath("/app/workflow");
  return { ok: true, autoAdvancedTo: advance.moved ? advance.toStageLabel : undefined };
}
