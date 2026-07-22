/**
 * Plain-language labels for the client portal (M4). Staff screens say
 * "T1 2025 · Awaiting docs"; clients see "2025 personal tax return". Keep
 * jargon-free and short — the portal audience is elderly/non-technical.
 */

export const PORTAL_ENGAGEMENT_LABELS: Record<"t1" | "t2" | "t3" | "other", string> = {
  t1: "personal tax return",
  t2: "business tax return",
  t3: "trust tax return",
  other: "work with your accountant",
};

export function portalEngagementLabel(type: "t1" | "t2" | "t3" | "other", taxYear: number) {
  return `${taxYear} ${PORTAL_ENGAGEMENT_LABELS[type]}`;
}

export const PORTAL_ITEM_STATUS: Record<
  "missing" | "received" | "waived",
  { label: string; tone: "todo" | "done" | "skip" }
> = {
  missing: { label: "Still needed", tone: "todo" },
  received: { label: "We have it", tone: "done" },
  waived: { label: "Not needed this year", tone: "skip" },
};
