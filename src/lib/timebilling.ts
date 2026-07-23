import type { schema } from "@/db";
import type { InvoiceLine } from "@/db/schema";

/**
 * Time & billing helpers (M7, ADR-0030). All money is integer CENTS — these
 * are the only places amounts are computed, so rounding rules live here.
 * (src/lib/billing.ts is the firm's own Stripe subscription — different thing.)
 */

export type TimeEntryRow = typeof schema.timeEntry.$inferSelect;
export type InvoiceRow = typeof schema.invoice.$inferSelect;

/** "INV-0001" — per-org sequence, zero-padded for tidy sorting in file names. */
export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** A time entry's dollar value: minutes × hourly rate, rounded per entry. */
export function entryAmountCents(entry: Pick<TimeEntryRow, "minutes" | "rateCents">): number {
  return Math.round((entry.minutes / 60) * entry.rateCents);
}

/** Snapshot time entries into invoice lines (ADR-0030). */
export function linesFromEntries(
  entries: Array<Pick<TimeEntryRow, "id" | "workDate" | "description" | "minutes" | "rateCents">>
): InvoiceLine[] {
  return entries.map((e) => ({
    description: `${e.workDate} — ${e.description}`,
    minutes: e.minutes,
    rateCents: e.rateCents,
    amountCents: entryAmountCents(e),
    timeEntryId: e.id,
  }));
}

export type InvoiceTotals = { subtotalCents: number; taxCents: number; totalCents: number };

/** Subtotal = sum of line amounts; tax rounded once on the subtotal. */
export function computeTotals(lines: InvoiceLine[], taxRateBps: number): InvoiceTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export const INVOICE_STATUS_LABELS: Record<InvoiceRow["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};
