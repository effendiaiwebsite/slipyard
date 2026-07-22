import type { EngagementStatus } from "@/db/schema";
import type { StaffContext } from "@/lib/context";

/**
 * Client-hub domain helpers shared by the grid, detail page, and workflow
 * board. Rendering metadata lives here so status naming/colors stay
 * consistent everywhere.
 */

export const STATUS_META: Record<
  EngagementStatus,
  { label: string; badge: "default" | "accent" | "success" | "warn" | "danger" | "ai"; board: string }
> = {
  not_started: { label: "Not started", badge: "default", board: "border-slate-300 bg-slate-50 text-slate-700" },
  awaiting_docs: { label: "Awaiting docs", badge: "warn", board: "border-amber-400 bg-amber-50 text-amber-800" },
  in_preparation: { label: "In preparation", badge: "accent", board: "border-indigo-400 bg-indigo-50 text-indigo-800" },
  in_review: { label: "In review", badge: "ai", board: "border-violet-500 bg-violet-50 text-violet-800" },
  awaiting_signature: { label: "Awaiting signature", badge: "warn", board: "border-orange-400 bg-orange-50 text-orange-800" },
  filed: { label: "Filed", badge: "success", board: "border-emerald-500 bg-emerald-50 text-emerald-800" },
  noa_received: { label: "NOA received", badge: "success", board: "border-teal-500 bg-teal-50 text-teal-800" },
};

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
