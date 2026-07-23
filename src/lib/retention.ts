/**
 * Document retention (M9, ADR-0034). Canadian practice: keep client records
 * (and the CRA-relevant documents behind them) for SEVEN years. The product's
 * posture is DELETE-FREE by design — vault documents and executed e-signature
 * PDFs have no delete path (ADR-0016/0027), so nothing is ever removed
 * automatically. What the retention flow provides is REVIEW: surface the
 * documents that have passed the 7-year horizon so a firm owner/admin can
 * decide, deliberately and on the record, what to do with them. Disposal (if
 * ever) stays a manual, audited act — never a job.
 *
 * Deleting a whole ORG is the one case with a cleanup path: DB rows cascade,
 * and the S3 objects under org/{orgId}/ are swept by scripts/cleanup-orphaned-s3.ts.
 */

export const RETENTION_YEARS = 7;

/** The cutoff: documents created on/before this date are past the 7-year hold. */
export function retentionHorizon(now: Date): Date {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - RETENTION_YEARS);
  return d;
}

export function isPastRetention(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() <= retentionHorizon(now).getTime();
}

/** Whole years a document has been retained (floor). */
export function retainedYears(createdAt: Date, now: Date): number {
  const ms = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}
