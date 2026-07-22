"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { STAGE_CATEGORIES } from "@/db/schema";
import { slugifyStageKey } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * Workflow-stage management (ADR-0015). Owner/admin only, via
 * org.update_settings. Stage KEYS are immutable; renames touch labels only,
 * so history (status_timestamps) and automations stay coherent.
 */

type ActionResult = { error?: string; ok?: boolean };

const MIN_STAGES = 2;

async function guard(): Promise<
  { ctx: Awaited<ReturnType<typeof requireStaff>> } | { error: string }
> {
  const ctx = await requireStaff();
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "org.update_settings",
      { orgId: ctx.orgId, type: "engagement_stage" },
      { readOnlyOrg: ctx.readOnly }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }
  return { ctx };
}

function refresh() {
  revalidatePath("/app/settings/stages");
  revalidatePath("/app/workflow");
  revalidatePath("/app");
}

const addSchema = z.object({
  label: z.string().trim().min(2).max(60),
  category: z.enum(STAGE_CATEGORIES),
});

export async function addStage(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const parsed = addSchema.safeParse({
    label: formData.get("label"),
    category: formData.get("category"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const stages = await g.ctx.scope.listStages();
  if (stages.some((s) => s.label.toLowerCase() === parsed.data.label.toLowerCase())) {
    return { error: "A stage with that name already exists." };
  }
  // Keys are unique per org: suffix if the slug is taken (e.g. re-added name).
  const base = slugifyStageKey(parsed.data.label);
  let key = base;
  for (let n = 2; stages.some((s) => s.key === key); n++) key = `${base}-${n}`;

  await g.ctx.scope.createStage({ key, label: parsed.data.label, category: parsed.data.category });
  refresh();
  return { ok: true };
}

const renameSchema = z.object({
  stageId: z.string().uuid(),
  label: z.string().trim().min(2).max(60),
});

export async function renameStage(stageId: string, label: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const parsed = renameSchema.safeParse({ stageId, label });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const stages = await g.ctx.scope.listStages();
  if (
    stages.some(
      (s) => s.id !== parsed.data.stageId && s.label.toLowerCase() === parsed.data.label.toLowerCase()
    )
  ) {
    return { error: "A stage with that name already exists." };
  }
  const updated = await g.ctx.scope.updateStage(parsed.data.stageId, { label: parsed.data.label });
  if (!updated) return { error: "Stage not found" };
  refresh();
  return { ok: true };
}

export async function setStageCategory(stageId: string, category: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const parsed = z
    .object({ stageId: z.string().uuid(), category: z.enum(STAGE_CATEGORIES) })
    .safeParse({ stageId, category });
  if (!parsed.success) return { error: "Invalid input" };
  const updated = await g.ctx.scope.updateStage(parsed.data.stageId, {
    category: parsed.data.category,
  });
  if (!updated) return { error: "Stage not found" };
  refresh();
  return { ok: true };
}

export async function moveStage(stageId: string, direction: "up" | "down"): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  if (!z.string().uuid().safeParse(stageId).success) return { error: "Invalid stage" };

  const stages = await g.ctx.scope.listStages();
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return { error: "Stage not found" };
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= stages.length) return { ok: true }; // already at the edge

  const order = stages.map((s) => s.id);
  [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
  await g.ctx.scope.setStagePositions(order);
  refresh();
  return { ok: true };
}

export async function deleteStage(
  stageId: string,
  reassignToId: string | null
): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  if (!z.string().uuid().safeParse(stageId).success) return { error: "Invalid stage" };
  if (reassignToId !== null && !z.string().uuid().safeParse(reassignToId).success) {
    return { error: "Invalid destination stage" };
  }
  if (reassignToId === stageId) return { error: "Pick a different destination stage." };

  const stages = await g.ctx.scope.listStages();
  if (stages.length <= MIN_STAGES) {
    return { error: `A workflow needs at least ${MIN_STAGES} stages.` };
  }
  if (reassignToId && !stages.some((s) => s.id === reassignToId)) {
    return { error: "Destination stage not found." };
  }

  const result = await g.ctx.scope.deleteStage(stageId, reassignToId ?? undefined);
  if (result === "not_found") return { error: "Stage not found" };
  if (result === "in_use") {
    return { error: "That stage has engagements in it — choose a stage to move them to first." };
  }
  refresh();
  return { ok: true };
}
