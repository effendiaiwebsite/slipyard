import type { OrgScope } from "@/db/scoped";
import type { StageCategory } from "@/db/schema";

/**
 * Checklist engine (M3): per-engagement document checklists seeded from the
 * engagement type, plus the auto-advance rules that move an engagement
 * along the pipeline as its checklist fills in.
 *
 * Auto-advance keys on stage CATEGORY only (ADR-0015) — never on stage keys
 * or labels, which firms rename freely:
 *   - items exist + required ones missing + engagement sits in a
 *     'not_started' stage      → first 'awaiting_docs' stage
 *   - items exist + no required missing + engagement sits in
 *     'not_started'/'awaiting_docs' → first 'in_progress' stage
 *   - engagements at 'in_progress' or beyond are NEVER moved by automation
 *     (docs arriving late must not yank a return out of review/filing),
 *     and nothing moves backwards.
 * If the org's custom pipeline lacks a target category, that rule is
 * skipped — automations degrade to no-ops, never guess a stage.
 */

export type ChecklistTemplateItem = { title: string; required: boolean };

/**
 * Default templates per engagement type. Titles reflect a small Canadian
 * firm's T1/T2/T3 intake; staff can add/waive per engagement, so templates
 * stay deliberately lean.
 */
export const CHECKLIST_TEMPLATES: Record<
  "t1" | "t2" | "t3" | "other",
  ReadonlyArray<ChecklistTemplateItem>
> = {
  t1: [
    { title: "Prior-year Notice of Assessment", required: true },
    { title: "T4 / employment income slips", required: true },
    { title: "T5 / T3 investment slips", required: false },
    { title: "RRSP contribution receipts", required: false },
    { title: "Medical expense receipts", required: false },
    { title: "Donation receipts", required: false },
    { title: "Property tax or rent amounts", required: false },
  ],
  t2: [
    { title: "Year-end financial statements", required: true },
    { title: "Trial balance / general ledger export", required: true },
    { title: "Business bank statements", required: true },
    { title: "GST/HST filings for the year", required: false },
    { title: "Payroll summaries (T4 Summary)", required: false },
    { title: "Prior-year T2 return", required: false },
  ],
  t3: [
    { title: "Trust financial statements", required: true },
    { title: "Beneficiary details and allocations", required: true },
    { title: "Investment income slips", required: false },
    { title: "Prior-year T3 return", required: false },
  ],
  // 'other' engagements start empty — staff define the list per engagement.
  other: [],
};

/**
 * Create the template items for an engagement that has none yet.
 * Idempotent: existing items (any state) mean no-op.
 */
export async function instantiateChecklist(
  scope: OrgScope,
  engagementId: string,
  type: "t1" | "t2" | "t3" | "other"
) {
  const existing = await scope.listChecklistItems(engagementId);
  if (existing.length > 0) return existing;
  const template = CHECKLIST_TEMPLATES[type];
  return scope.createChecklistItems(
    engagementId,
    template.map((t, i) => ({ ...t, position: i }))
  );
}

export type AutoAdvanceResult =
  | { moved: false }
  | { moved: true; toStageId: string; toStageLabel: string; toCategory: StageCategory };

/** Categories automation may move an engagement OUT of. Everything later is hands-off. */
const MOVABLE_FROM: ReadonlySet<StageCategory> = new Set(["not_started", "awaiting_docs"]);

/**
 * Re-evaluate an engagement's stage after any checklist state change.
 * Writes a system audit entry when it moves the engagement.
 */
export async function applyAutoAdvance(
  scope: OrgScope,
  engagementId: string
): Promise<AutoAdvanceResult> {
  const engagement = await scope.getEngagement(engagementId);
  if (!engagement) return { moved: false };

  const stages = await scope.listStages();
  const current = stages.find((s) => s.id === engagement.stageId);
  if (!current || !MOVABLE_FROM.has(current.category)) return { moved: false };

  const items = await scope.listChecklistItems(engagementId);
  if (items.length === 0) return { moved: false };
  const requiredMissing = items.some((i) => i.required && i.status === "missing");

  let target: (typeof stages)[number] | undefined;
  if (!requiredMissing) {
    // Checklist satisfied → work can start.
    target = stages.find((s) => s.category === "in_progress");
  } else if (current.category === "not_started") {
    // Checklist exists and is incomplete → the client owes us documents.
    target = stages.find((s) => s.category === "awaiting_docs");
  }
  if (!target || target.id === engagement.stageId) return { moved: false };

  await scope.transitionEngagement(engagementId, target.id);
  await scope.writeAudit({
    actorType: "system",
    action: "engagements.auto_advance",
    resourceType: "engagement",
    resourceId: engagementId,
    details: {
      trigger: "checklist",
      fromStageId: engagement.stageId,
      toStageId: target.id,
      toCategory: target.category,
    },
  });
  return {
    moved: true,
    toStageId: target.id,
    toStageLabel: target.label,
    toCategory: target.category,
  };
}
