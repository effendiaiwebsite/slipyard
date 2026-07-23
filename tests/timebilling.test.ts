import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import { can, type Actor } from "@/lib/permissions";
import {
  computeTotals,
  entryAmountCents,
  formatCents,
  formatInvoiceNumber,
  formatMinutes,
  linesFromEntries,
} from "@/lib/timebilling";
import { createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M7 time & billing (ADR-0030): money math, atomic invoice creation with
 * per-org numbering + entry stamping, void releasing entries back to WIP,
 * on-demand PDF generation, RLS isolation, permission matrix rows.
 */

describe("money math", () => {
  it("formats invoice numbers and amounts", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-0001");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
    expect(formatCents(93225)).toBe("$932.25");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
  });

  it("rounds each entry's amount once (minutes × hourly rate)", () => {
    // 50 min at $175/h = 145.833… → 14583 cents.
    expect(entryAmountCents({ minutes: 50, rateCents: 17500 })).toBe(14583);
  });

  it("computes totals with tax rounded once on the subtotal", () => {
    const lines = linesFromEntries([
      { id: "e1", workDate: "2026-07-03", description: "GL review", minutes: 180, rateCents: 17500 },
      { id: "e2", workDate: "2026-07-06", description: "CCA planning", minutes: 90, rateCents: 20000 },
    ]);
    expect(lines[0].amountCents).toBe(52500);
    expect(lines[1].amountCents).toBe(30000);
    const totals = computeTotals(lines, 1300);
    expect(totals).toEqual({ subtotalCents: 82500, taxCents: 10725, totalCents: 93225 });
  });
});

describe("generateInvoicePdf", () => {
  it("produces a loadable PDF for a realistic invoice", async () => {
    const lines = linesFromEntries([
      { id: "e1", workDate: "2026-07-03", description: "Year-end file setup", minutes: 180, rateCents: 17500 },
    ]);
    const totals = computeTotals(lines, 1300);
    const pdf = await generateInvoicePdf({
      invoice: {
        number: 7,
        status: "sent",
        issueDate: "2026-07-07",
        dueDate: "2026-08-06",
        lines,
        subtotalCents: totals.subtotalCents,
        taxLabel: "HST (13%)",
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: "Interim billing.",
      },
      firmName: "Lakeside CPA",
      clientName: "Pines & Birch Landscaping Ltd.",
      clientAddress: "1 Yard Way, Vaughan, ON",
    });
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("paginates a long line list instead of overflowing", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      workDate: "2026-07-01",
      description: `Detailed piece of work number ${i} with a reasonably long description`,
      minutes: 30,
      rateCents: 20000,
    }));
    const lines = linesFromEntries(entries);
    const totals = computeTotals(lines, 1300);
    const pdf = await generateInvoicePdf({
      invoice: {
        number: 8,
        status: "draft",
        issueDate: "2026-07-07",
        dueDate: null,
        lines,
        subtotalCents: totals.subtotalCents,
        taxLabel: "HST (13%)",
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: null,
      },
      firmName: "Lakeside CPA",
      clientName: "Busy Client",
      clientAddress: null,
    });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });
});

// ---- DB-backed ---------------------------------------------------------------

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientA1: string;
let clientA2: string;
let clientB: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);
  clientA1 = (
    await scopeA.createClient({ type: "corporation", displayName: "Client A1", createdBy: f.userA })
  ).id;
  clientA2 = (
    await scopeA.createClient({ type: "individual", displayName: "Client A2", createdBy: f.userA })
  ).id;
  clientB = (
    await scopeB.createClient({ type: "individual", displayName: "Client B", createdBy: f.userB })
  ).id;
});

afterAll(async () => {
  await destroyFixture(f);
  const { pool } = await import("@/db");
  await pool.end();
});

async function addEntry(scope: OrgScope, clientId: string, userId: string, minutes = 60) {
  return scope.createTimeEntry({
    clientId,
    userId,
    workDate: "2026-07-10",
    minutes,
    description: "Test work",
    rateCents: 20000,
    createdBy: userId,
  });
}

describe("invoicing", () => {
  it("creates per-org sequential invoices and stamps exactly the billed entries", async () => {
    const e1 = await addEntry(scopeA, clientA1, f.userA, 60);
    const e2 = await addEntry(scopeA, clientA1, f.userA, 30);
    const other = await addEntry(scopeA, clientA2, f.userA, 45); // different client
    const bEntry = await addEntry(scopeB, clientB, f.userB, 45); // different org

    const inv1 = await scopeA.createInvoiceWithEntries({
      clientId: clientA1,
      // Foreign/billed ids are ignored, not invoiced.
      entryIds: [e1.id, e2.id, other.id, bEntry.id],
      issueDate: "2026-07-22",
      taxLabel: "HST (13%)",
      taxRateBps: 1300,
      createdBy: f.userA,
    });
    expect(inv1).not.toBeNull();
    expect(inv1!.number).toBe(1);
    expect(inv1!.lines).toHaveLength(2);
    expect(inv1!.subtotalCents).toBe(20000 + 10000);
    expect(inv1!.taxCents).toBe(3900);
    expect(inv1!.totalCents).toBe(33900);

    // Only A1's two entries were stamped.
    expect((await scopeA.getTimeEntry(e1.id))!.invoiceId).toBe(inv1!.id);
    expect((await scopeA.getTimeEntry(other.id))!.invoiceId).toBeNull();
    expect((await scopeB.getTimeEntry(bEntry.id))!.invoiceId).toBeNull();

    // Next invoice in org A is #2; org B starts at its own #1.
    const inv2 = await scopeA.createInvoiceWithEntries({
      clientId: clientA2,
      entryIds: [other.id],
      issueDate: "2026-07-22",
      taxLabel: "HST (13%)",
      taxRateBps: 1300,
    });
    expect(inv2!.number).toBe(2);
    const invB = await scopeB.createInvoiceWithEntries({
      clientId: clientB,
      entryIds: [bEntry.id],
      issueDate: "2026-07-22",
      taxLabel: "GST (5%)",
      taxRateBps: 500,
    });
    expect(invB!.number).toBe(1);
  });

  it("returns null instead of an empty invoice", async () => {
    const nothing = await scopeA.createInvoiceWithEntries({
      clientId: clientA1,
      entryIds: [crypto.randomUUID()],
      issueDate: "2026-07-22",
      taxLabel: "HST (13%)",
      taxRateBps: 1300,
    });
    expect(nothing).toBeNull();
  });

  it("void releases the entries back to unbilled WIP", async () => {
    const e = await addEntry(scopeA, clientA1, f.userA, 90);
    const inv = await scopeA.createInvoiceWithEntries({
      clientId: clientA1,
      entryIds: [e.id],
      issueDate: "2026-07-22",
      taxLabel: "HST (13%)",
      taxRateBps: 1300,
    });
    expect((await scopeA.getTimeEntry(e.id))!.invoiceId).toBe(inv!.id);

    const voided = await scopeA.setInvoiceStatus(inv!.id, "void");
    expect(voided!.status).toBe("void");
    expect(voided!.voidedAt).toBeTruthy();
    expect((await scopeA.getTimeEntry(e.id))!.invoiceId).toBeNull();
    // The snapshot survives on the voided row for the record.
    expect(voided!.lines).toHaveLength(1);
  });

  it("sent/paid stamp their timestamps", async () => {
    const e = await addEntry(scopeA, clientA1, f.userA, 30);
    const inv = await scopeA.createInvoiceWithEntries({
      clientId: clientA1,
      entryIds: [e.id],
      issueDate: "2026-07-22",
      taxLabel: "HST (13%)",
      taxRateBps: 1300,
    });
    const sent = await scopeA.setInvoiceStatus(inv!.id, "sent");
    expect(sent!.sentAt).toBeTruthy();
    const paid = await scopeA.setInvoiceStatus(inv!.id, "paid");
    expect(paid!.paidAt).toBeTruthy();
  });

  it("unbilled-only listing excludes invoiced entries", async () => {
    const unbilled = await scopeA.listTimeEntries({ unbilledOnly: true });
    expect(unbilled.every((r) => r.entry.invoiceId === null)).toBe(true);
  });

  it("deleteTimeEntry refuses invoiced entries", async () => {
    const invoiced = (await scopeA.listTimeEntries()).find((r) => r.entry.invoiceId);
    expect(invoiced).toBeTruthy();
    await scopeA.deleteTimeEntry(invoiced!.entry.id); // silently a no-op (where clause)
    expect(await scopeA.getTimeEntry(invoiced!.entry.id)).not.toBeNull();
  });

  it("RLS: org B sees none of org A's billing data", async () => {
    const aInvoice = (await scopeA.listInvoices())[0];
    expect(await scopeB.getInvoice(aInvoice.invoice.id)).toBeNull();
    const bEntries = await scopeB.listTimeEntries();
    expect(bEntries.every((r) => r.clientName === "Client B")).toBe(true);
  });
});

describe("permission matrix — time & billing", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: "u1", orgId: "o1", role });
  const res = (assignedTo: string | null) => ({ orgId: "o1", type: "client", assignedTo });

  it("clerks view but never record time or manage invoices", () => {
    expect(can(actor("clerk"), "invoices.view")).toBe(true);
    expect(can(actor("clerk"), "time.record", res("u1"))).toBe(false);
    expect(can(actor("clerk"), "invoices.manage", res("u1"))).toBe(false);
  });

  it("accountants record/invoice only their assigned clients", () => {
    expect(can(actor("accountant"), "time.record", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "time.record", res("u2"))).toBe(false);
    expect(can(actor("accountant"), "invoices.manage", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "invoices.manage", res("u2"))).toBe(false);
    expect(can(actor("owner"), "invoices.manage", res("u2"))).toBe(true);
  });
});
