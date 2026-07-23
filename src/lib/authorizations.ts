import type { schema } from "@/db";

/**
 * CRA authorization coverage (M7, ADR-0028). Pure derivation — the DB stores
 * what staff recorded; these helpers compute the EFFECTIVE state (an 'active'
 * row past its expiry date counts as expired without anyone editing it) and
 * roll a client's rows up to one coverage verdict for dashboards.
 */

export type AuthorizationRow = typeof schema.craAuthorization.$inferSelect;

export type EffectiveAuthStatus = "active" | "pending" | "expired" | "revoked";

/** Coverage verdict for one client, best row wins. 'none' = no records at all. */
export type CoverageStatus = "active" | "pending" | "expired" | "revoked" | "none";

export const AUTH_LEVEL_LABELS: Record<AuthorizationRow["level"], string> = {
  level1: "Level 1 — view",
  level2: "Level 2 — view & change",
  level3: "Level 3 — delegate",
};

export const AUTH_STATUS_BADGE: Record<
  EffectiveAuthStatus,
  { label: string; variant: "default" | "accent" | "success" | "warn" | "danger" }
> = {
  active: { label: "Active", variant: "success" },
  pending: { label: "Pending CRA", variant: "warn" },
  expired: { label: "Expired", variant: "danger" },
  revoked: { label: "Revoked", variant: "danger" },
};

/** Active authorizations expiring within this window surface as "expiring soon". */
export const EXPIRING_SOON_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compare a DATE column value (YYYY-MM-DD) against a reference instant. */
function dateIsPast(dateStr: string, today: Date): boolean {
  // End of that calendar day, UTC — an authorization expires AFTER its expiry date.
  return new Date(`${dateStr}T23:59:59Z`).getTime() < today.getTime();
}

/** What a row counts as right now: 'active' decays to 'expired' past expiry_date. */
export function effectiveAuthStatus(
  row: Pick<AuthorizationRow, "status" | "expiryDate">,
  today: Date
): EffectiveAuthStatus {
  if (row.status === "active" && row.expiryDate && dateIsPast(row.expiryDate, today)) {
    return "expired";
  }
  return row.status;
}

export type ClientCoverage = {
  status: CoverageStatus;
  /** The row backing the verdict (best row), if any. */
  row: AuthorizationRow | null;
  /** Set when status is 'active' and expiry falls within EXPIRING_SOON_DAYS. */
  expiringSoon: boolean;
};

const COVERAGE_RANK: Record<EffectiveAuthStatus, number> = {
  active: 3,
  pending: 2,
  expired: 1,
  revoked: 0,
};

/** Roll a client's rows up to one verdict: active > pending > expired > revoked. */
export function summarizeCoverage(rows: AuthorizationRow[], today: Date): ClientCoverage {
  let best: { row: AuthorizationRow; status: EffectiveAuthStatus } | null = null;
  for (const row of rows) {
    const status = effectiveAuthStatus(row, today);
    if (!best || COVERAGE_RANK[status] > COVERAGE_RANK[best.status]) best = { row, status };
  }
  if (!best) return { status: "none", row: null, expiringSoon: false };
  const expiringSoon =
    best.status === "active" &&
    !!best.row.expiryDate &&
    new Date(`${best.row.expiryDate}T23:59:59Z`).getTime() - today.getTime() <=
      EXPIRING_SOON_DAYS * DAY_MS;
  return { status: best.status, row: best.row, expiringSoon };
}

/** True when the client needs staff attention (no usable CRA access). */
export function needsAttention(coverage: ClientCoverage): boolean {
  return coverage.status !== "active" || coverage.expiringSoon;
}
