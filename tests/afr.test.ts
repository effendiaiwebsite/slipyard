import { describe, expect, it } from "vitest";
import {
  compareAfr,
  normalizeSlipType,
  parseAfrCsv,
  AFR_SAMPLE_CSV,
  type AfrChecklistItem,
} from "@/lib/afr";

/**
 * M7 AFR reconciliation — pure parsing + matching (ADR-0029). No DB: the
 * compare is a derivation over pasted CSV + checklist/document snapshots.
 */

describe("parseAfrCsv", () => {
  it("parses the documented comma format with amounts", () => {
    const { slips, warnings } = parseAfrCsv(AFR_SAMPLE_CSV);
    expect(warnings).toEqual([]);
    expect(slips).toHaveLength(5);
    expect(slips[0]).toEqual({
      slipType: "T4",
      issuer: "Northgate Manufacturing Inc.",
      amountCents: 6245000,
    });
    expect(slips[3].slipType).toBe("T4A(OAS)");
  });

  it("auto-detects tab and semicolon delimiters", () => {
    const tab = parseAfrCsv("slip\tissuer\nT4\tAcme Corp");
    expect(tab.slips).toEqual([{ slipType: "T4", issuer: "Acme Corp", amountCents: null }]);
    const semi = parseAfrCsv("type;payer\nT5;Big Bank");
    expect(semi.slips).toEqual([{ slipType: "T5", issuer: "Big Bank", amountCents: null }]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    const { slips } = parseAfrCsv('slip type,issuer\nT5,"Bank of Toronto, Main Branch"');
    expect(slips[0].issuer).toBe("Bank of Toronto, Main Branch");
  });

  it("reports a missing slip-type column instead of guessing", () => {
    const { slips, warnings } = parseAfrCsv("payer,amount\nAcme,100");
    expect(slips).toEqual([]);
    expect(warnings[0]).toMatch(/slip-type column/);
  });

  it("skips typeless rows with a line-numbered warning", () => {
    const { slips, warnings } = parseAfrCsv("slip,issuer\nT4,Acme\n,Orphan Inc");
    expect(slips).toHaveLength(1);
    expect(warnings[0]).toMatch(/Line 3/);
  });

  it("parses currency-formatted amounts and nulls unparsable ones", () => {
    const { slips } = parseAfrCsv('slip,amount\nT4,n/a\nT5,"$1,208.77"');
    expect(slips[0].amountCents).toBeNull();
    expect(slips[1].amountCents).toBe(120877);
  });
});

describe("normalizeSlipType", () => {
  it("uppercases and strips spaces", () => {
    expect(normalizeSlipType("t4a (oas)")).toBe("T4A(OAS)");
    expect(normalizeSlipType(" t5008 ")).toBe("T5008");
  });
});

const item = (
  title: string,
  status: AfrChecklistItem["status"] = "missing",
  required = true
): AfrChecklistItem => ({ id: title, title, status, required });

const slip = (slipType: string, issuer = "") => ({ slipType, issuer, amountCents: null });

describe("compareAfr", () => {
  const t1Items = [
    item("Prior-year Notice of Assessment", "received"),
    item("T4 / employment income slips", "received"),
    item("T5 / T3 investment slips", "missing", false),
    item("Donation receipts", "waived", false),
  ];

  it("classifies on_file / missing / untracked", () => {
    const result = compareAfr(
      [slip("T4", "Acme"), slip("T5", "Bank"), slip("RRSP", "Fund Co")],
      t1Items,
      []
    );
    expect(result.slips.map((s) => s.verdict)).toEqual(["on_file", "missing", "untracked"]);
    expect(result.counts).toEqual({ on_file: 1, missing: 1, waived: 0, untracked: 1 });
  });

  it("a document filename upgrades a missing item to on_file", () => {
    const result = compareAfr(
      [slip("T5")],
      t1Items,
      [{ id: "d1", filename: "T5 - Scotiabank 2025.pdf" }]
    );
    expect(result.slips[0].verdict).toBe("on_file");
    expect(result.slips[0].matchedDocumentName).toBe("T5 - Scotiabank 2025.pdf");
  });

  it("flags a waived item the CRA still has a slip for", () => {
    const result = compareAfr([slip("T4")], [item("T4 / employment income slips", "waived")], []);
    expect(result.slips[0].verdict).toBe("waived");
  });

  it("does not confuse T4 with T4A / T4A(OAS) / T5 with T5008", () => {
    const items = [item("T4A(OAS) slip"), item("T5008 trading summary")];
    const result = compareAfr([slip("T4"), slip("T5")], items, []);
    // Neither the T4A(OAS) item nor the T5008 item covers a plain T4/T5.
    expect(result.slips.map((s) => s.verdict)).toEqual(["untracked", "untracked"]);

    const reverse = compareAfr([slip("T4A(OAS)"), slip("T5008")], items, []);
    expect(reverse.slips.map((s) => s.verdict)).toEqual(["missing", "missing"]);
  });

  it("surfaces slip-shaped checklist items the CRA data lacks (reverse check)", () => {
    const result = compareAfr([slip("T4")], t1Items, []);
    // "T5 / T3 investment slips" names slip families absent from the paste;
    // the NOA / donation items are not slip-shaped and stay out.
    expect(result.itemsNotInCra).toEqual([
      { title: "T5 / T3 investment slips", status: "missing" },
    ]);
  });
});
