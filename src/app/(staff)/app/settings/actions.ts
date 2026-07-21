"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import { authorize } from "@/lib/permissions";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.enum([
    "America/St_Johns",
    "America/Halifax",
    "America/Toronto",
    "America/Winnipeg",
    "America/Regina",
    "America/Edmonton",
    "America/Vancouver",
  ]),
});

type ActionResult = { error?: string; ok?: boolean };

export async function updateOrgProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await authorize(ctx.scope, ctx.actor, "org.update_settings", { orgId: ctx.orgId, type: "org", id: ctx.orgId }, {
    readOnlyOrg: ctx.readOnly,
    details: { op: "profile", ...parsed.data },
  });
  await ctx.scope.updateOrgProfile(parsed.data);
  revalidatePath("/app/settings");
  return { ok: true };
}

const settingsSchema = z.object({
  ai_enabled: z.boolean(),
  accountant_scope_mode: z.enum(["all_read", "assigned_only"]),
});

export async function updateOrgSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = settingsSchema.safeParse({
    ai_enabled: formData.get("ai_enabled") === "on",
    accountant_scope_mode: formData.get("accountant_scope_mode"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  await authorize(ctx.scope, ctx.actor, "org.update_settings", { orgId: ctx.orgId, type: "org", id: ctx.orgId }, {
    readOnlyOrg: ctx.readOnly,
    details: { op: "settings", ...parsed.data },
  });
  await ctx.scope.updateOrgSettings(parsed.data);
  revalidatePath("/app/settings");
  return { ok: true };
}
