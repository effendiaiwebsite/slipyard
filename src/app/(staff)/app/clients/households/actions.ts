"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

type ActionResult = { error?: string; ok?: boolean };

/**
 * Household structure is firm-wide (a household can span several accountants'
 * books), so mutations authorize clients.update with no assignee — the same
 * rule as bulk distribute: owner/admin pass, an accountant's 'assigned' rule
 * can't, clerks are denied outright. Denials come back as friendly messages
 * (still audited by authorize).
 */
async function gate(
  ctx: Awaited<ReturnType<typeof requireStaff>>,
  op: string,
  householdId?: string
): Promise<string | null> {
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "clients.update",
      { orgId: ctx.orgId, type: "household", id: householdId },
      { readOnlyOrg: ctx.readOnly, details: { op } }
    );
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) {
      return "Household changes need an administrator.";
    }
    throw e;
  }
}

const renameSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
});

export async function renameHousehold(householdId: string, name: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = renameSchema.safeParse({ householdId, name });
  if (!parsed.success) return { error: "Household names are 2–120 characters." };
  const denied = await gate(ctx, "rename_household", parsed.data.householdId);
  if (denied) return { error: denied };

  const updated = await ctx.scope.renameHousehold(parsed.data.householdId, parsed.data.name);
  if (!updated) return { error: "Household not found." };
  revalidatePath("/app/clients/households");
  revalidatePath("/app/clients");
  return { ok: true };
}

const mergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export async function mergeHouseholds(sourceId: string, targetId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = mergeSchema.safeParse({ sourceId, targetId });
  if (!parsed.success) return { error: "Invalid input" };
  if (parsed.data.sourceId === parsed.data.targetId) {
    return { error: "Pick two different households to merge." };
  }
  const denied = await gate(ctx, "merge_households", parsed.data.sourceId);
  if (denied) return { error: denied };

  const res = await ctx.scope.mergeHouseholds(parsed.data.sourceId, parsed.data.targetId);
  if (!res) return { error: "One of those households no longer exists." };
  revalidatePath("/app/clients/households");
  revalidatePath("/app/clients");
  return { ok: true };
}

export async function deleteEmptyHousehold(householdId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(householdId).success) return { error: "Invalid input" };
  const denied = await gate(ctx, "delete_household", householdId);
  if (denied) return { error: denied };

  const res = await ctx.scope.deleteEmptyHousehold(householdId);
  if (!res.ok) {
    return {
      error:
        res.reason === "not_empty"
          ? "That household still has members — move them first (or merge)."
          : "Household not found.",
    };
  }
  revalidatePath("/app/clients/households");
  revalidatePath("/app/clients");
  return { ok: true };
}
