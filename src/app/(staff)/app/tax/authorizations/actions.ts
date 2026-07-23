"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * CRA authorization mutations (M7). requireStaff → zod → authorize()
 * (authorizations.manage, accountants on assigned clients only) → OrgScope.
 */

export type AuthActionResult = { error?: string; ok?: boolean } | null;

const uuid = z.string().uuid();

async function tryAuthorize(...args: Parameters<typeof authorize>): Promise<string | null> {
  try {
    await authorize(...args);
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

async function authorizeManage(
  ctx: StaffContext,
  clientId: string,
  details: Record<string, unknown>
): Promise<string | null> {
  const client = await ctx.scope.getClient(clientId);
  if (!client) return "Client not found";
  return tryAuthorize(
    ctx.scope,
    ctx.actor,
    "authorizations.manage",
    {
      orgId: client.orgId,
      type: "cra_authorization",
      id: clientId,
      assignedTo: client.assignedAccountantId,
    },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details }
  );
}

const recordSchema = z.object({
  level: z.enum(["level1", "level2", "level3"]),
  status: z.enum(["pending", "active", "expired", "revoked"]),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function revalidateAuthViews(clientId: string) {
  revalidatePath("/app/tax/authorizations");
  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app");
  revalidatePath("/app/reports");
}

/** Add an authorization record to a client. */
export async function createAuthorizationRecord(
  clientId: string,
  _prev: AuthActionResult,
  formData: FormData
): Promise<AuthActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(clientId).success) return { error: "Invalid client" };
  const parsed = recordSchema.safeParse({
    level: formData.get("level"),
    status: formData.get("status"),
    expiryDate: formData.get("expiryDate") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const denied = await authorizeManage(ctx, clientId, { op: "create", ...parsed.data });
  if (denied) return { error: denied };

  await ctx.scope.createAuthorization({
    clientId,
    level: parsed.data.level,
    status: parsed.data.status,
    expiryDate: parsed.data.expiryDate || null,
    notes: parsed.data.notes || null,
    createdBy: ctx.user.id,
  });
  revalidateAuthViews(clientId);
  return { ok: true };
}

/** Update an existing record (status change, expiry correction, notes). */
export async function updateAuthorizationRecord(
  authId: string,
  _prev: AuthActionResult,
  formData: FormData
): Promise<AuthActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(authId).success) return { error: "Invalid record" };
  const existing = await ctx.scope.getAuthorization(authId);
  if (!existing) return { error: "Authorization record not found" };
  const parsed = recordSchema.safeParse({
    level: formData.get("level"),
    status: formData.get("status"),
    expiryDate: formData.get("expiryDate") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const denied = await authorizeManage(ctx, existing.clientId, { op: "update", authId });
  if (denied) return { error: denied };

  await ctx.scope.updateAuthorization(authId, {
    level: parsed.data.level,
    status: parsed.data.status,
    expiryDate: parsed.data.expiryDate || null,
    notes: parsed.data.notes || null,
  });
  revalidateAuthViews(existing.clientId);
  return { ok: true };
}

/** Remove a record added in error. Real lifecycle changes use status instead. */
export async function deleteAuthorizationRecord(authId: string): Promise<AuthActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(authId).success) return { error: "Invalid record" };
  const existing = await ctx.scope.getAuthorization(authId);
  if (!existing) return { error: "Authorization record not found" };

  const denied = await authorizeManage(ctx, existing.clientId, { op: "delete", authId });
  if (denied) return { error: denied };

  await ctx.scope.deleteAuthorization(authId);
  revalidateAuthViews(existing.clientId);
  return { ok: true };
}
