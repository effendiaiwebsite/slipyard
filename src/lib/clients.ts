import type { StageCategory } from "@/db/schema";
import type { StaffContext } from "@/lib/context";

/**
 * Client-hub domain helpers shared by the grid, detail page, workflow board,
 * and stage settings. Stages are per-org rows (ADR-0015); colors and
 * automation hooks key off the stage's fixed CATEGORY, never its label.
 */

export const CATEGORY_META: Record<
  StageCategory,
  {
    label: string; // what the category means, shown in stage settings
    badge: "default" | "accent" | "success" | "warn" | "danger" | "ai";
    board: string;
  }
> = {
  not_started: { label: "Not started yet", badge: "default", board: "border-slate-300 bg-slate-50 text-slate-700" },
  awaiting_docs: { label: "Waiting on client documents", badge: "warn", board: "border-amber-400 bg-amber-50 text-amber-800" },
  in_progress: { label: "Being worked on", badge: "accent", board: "border-indigo-400 bg-indigo-50 text-indigo-800" },
  awaiting_signature: { label: "Waiting on a signature", badge: "ai", board: "border-violet-500 bg-violet-50 text-violet-800" },
  filed: { label: "Filed with CRA", badge: "success", board: "border-emerald-500 bg-emerald-50 text-emerald-800" },
  complete: { label: "Complete (NOA in hand)", badge: "success", board: "border-teal-500 bg-teal-50 text-teal-800" },
};

/** Immutable slug from a stage label: "Partner review" → "partner-review". */
export function slugifyStageKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "stage"
  );
}

export const TYPE_LABELS = { individual: "Individual", corporation: "Corporation", trust: "Trust" } as const;

export const ENGAGEMENT_TYPE_LABELS = { t1: "T1", t2: "T2", t3: "T3", other: "Other" } as const;

export const CHANNEL_LABELS = {
  email: "Email",
  sms: "SMS",
  phone: "Phone",
  mail: "Mail",
  meeting: "Meeting",
  other: "Other",
} as const;

/**
 * View-scope restriction (ADR-0004): accountants in assigned_only orgs see
 * just their own clients/engagements; everyone else sees the whole firm.
 * Write scoping is authorize()'s job — this only narrows list queries.
 */
export function viewAssignedOnlyFilter(
  ctx: Pick<StaffContext, "role" | "orgSettings" | "user">
): string | undefined {
  return ctx.role === "accountant" && ctx.orgSettings.accountant_scope_mode === "assigned_only"
    ? ctx.user.id
    : undefined;
}
