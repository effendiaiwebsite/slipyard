/**
 * AFR (Auto-fill My Return) reconciliation (M7, ADR-0029). The firm's EFILE
 * software downloads the CRA's slip list; staff export/copy it as CSV and
 * paste it here. We parse tolerantly, then compare the slips against what's
 * on file for the engagement (checklist items + document filenames) and
 * surface mismatches. Pure functions — the compare never writes anything.
 */

export type AfrSlip = {
  /** Normalised slip type, e.g. "T4", "T4A", "T5", "T5008", "T3", "RRSP". */
  slipType: string;
  /** Who issued it (employer/bank/fund), as pasted. */
  issuer: string;
  /** Optional dollar amount, in cents, when the export includes one. */
  amountCents: number | null;
};

export type AfrParseResult = {
  slips: AfrSlip[];
  /** Human-readable problems (skipped lines etc.) — parsing is best-effort. */
  warnings: string[];
};

/** Header aliases seen across tax-software AFR/slip exports. */
const TYPE_HEADERS = ["slip", "slip type", "slip_type", "type", "form", "slipname", "slip name"];
const ISSUER_HEADERS = ["issuer", "payer", "employer", "source", "description", "name"];
const AMOUNT_HEADERS = ["amount", "total", "income", "box 14", "box14", "value"];

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

/** Minimal CSV field splitter with double-quote support (no embedded newlines). */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "T4A (OAS)" → "T4A(OAS)"; "t5008" → "T5008". */
export function normalizeSlipType(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[.]/g, "");
}

function parseAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/**
 * Parse a pasted CRA slip CSV. Expects a header row naming at least a slip
 * type column; issuer/amount columns are picked up when present. Delimiter
 * (comma/semicolon/tab) is auto-detected from the header row.
 */
export function parseAfrCsv(text: string): AfrParseResult {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { slips: [], warnings: ["Nothing to parse — paste the CSV first."] };

  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const typeIdx = header.findIndex((h) => TYPE_HEADERS.includes(h));
  if (typeIdx === -1) {
    return {
      slips: [],
      warnings: [
        `Couldn't find a slip-type column. The first row should name one of: ${TYPE_HEADERS.join(", ")}.`,
      ],
    };
  }
  const issuerIdx = header.findIndex((h) => ISSUER_HEADERS.includes(h));
  const amountIdx = header.findIndex((h) => AMOUNT_HEADERS.includes(h));

  const slips: AfrSlip[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const rawType = cells[typeIdx] ?? "";
    if (!rawType) {
      warnings.push(`Line ${i + 1}: no slip type — skipped.`);
      continue;
    }
    slips.push({
      slipType: normalizeSlipType(rawType),
      issuer: issuerIdx >= 0 ? (cells[issuerIdx] ?? "") : "",
      amountCents: amountIdx >= 0 ? parseAmountCents(cells[amountIdx] ?? "") : null,
    });
  }
  if (slips.length === 0 && warnings.length === 0) {
    warnings.push("The CSV had a header but no slip rows.");
  }
  return { slips, warnings };
}

// ---- matching ----------------------------------------------------------------

/**
 * Word-boundary matchers per slip family. Deliberately strict about
 * lookalikes: "T4" must not match "T4A"/"T4E"/"T4RSP", "T5" must not match
 * "T5008"/"T5013". Titles/filenames are matched case-insensitively.
 */
const SLIP_MATCHERS: ReadonlyArray<{ prefix: string; pattern: RegExp }> = [
  { prefix: "T4A(OAS)", pattern: /T4A\s*\(\s*OAS\s*\)/i },
  { prefix: "T4A(P)", pattern: /T4A\s*\(\s*P\s*\)/i },
  { prefix: "T4RSP", pattern: /\bT4RSP\b/i },
  { prefix: "T4RIF", pattern: /\bT4RIF\b/i },
  { prefix: "T4A", pattern: /\bT4A\b(?!\s*\()/i },
  { prefix: "T4E", pattern: /\bT4E\b/i },
  // \b already refuses T4A/T4E/T4RSP ("T4" then a letter has no boundary).
  { prefix: "T4", pattern: /\bT4\b/i },
  { prefix: "T5008", pattern: /\bT5008\b/i },
  { prefix: "T5013", pattern: /\bT5013\b/i },
  { prefix: "T5007", pattern: /\bT5007\b/i },
  { prefix: "T5", pattern: /\bT5\b/i },
  { prefix: "T3", pattern: /\bT3\b/i },
  { prefix: "T2202", pattern: /\bT2202\b/i },
  { prefix: "RRSP", pattern: /\bRRSP\b/i },
  { prefix: "RC62", pattern: /\bRC62\b/i },
];

/** The matcher for a normalised slip type, longest prefix wins. */
function matcherFor(slipType: string) {
  return SLIP_MATCHERS.find((m) => slipType.startsWith(m.prefix)) ?? null;
}

export type AfrChecklistItem = {
  id: string;
  title: string;
  status: "missing" | "received" | "waived";
  required: boolean;
};

export type AfrDocument = { id: string; filename: string };

export type SlipVerdict =
  /** A received checklist item or an on-file document covers it. */
  | "on_file"
  /** A checklist item tracks it but it hasn't arrived. */
  | "missing"
  /** The tracking item was waived ("not needed") — yet the CRA has the slip. */
  | "waived"
  /** Nothing on the engagement tracks this slip at all. */
  | "untracked";

export type SlipComparison = {
  slip: AfrSlip;
  verdict: SlipVerdict;
  matchedItemTitle: string | null;
  matchedDocumentName: string | null;
};

export type AfrComparison = {
  slips: SlipComparison[];
  /** Slip-shaped checklist items the CRA data does NOT corroborate. */
  itemsNotInCra: { title: string; status: "missing" | "received" | "waived" }[];
  counts: Record<SlipVerdict, number>;
};

/**
 * Compare parsed CRA slips against the engagement's checklist and the
 * client's documents. Checklist state wins over a filename match (staff
 * marked it), except that an on-file document upgrades 'missing'.
 */
export function compareAfr(
  slips: AfrSlip[],
  items: AfrChecklistItem[],
  documents: AfrDocument[]
): AfrComparison {
  const comparisons: SlipComparison[] = slips.map((slip) => {
    const matcher = matcherFor(slip.slipType);
    // Without a known matcher, fall back to a literal token match.
    const test = (text: string) =>
      matcher ? matcher.pattern.test(text) : text.toUpperCase().includes(slip.slipType);

    const item = items.find((i) => test(i.title));
    const doc = documents.find((d) => test(d.filename));

    let verdict: SlipVerdict;
    if (item?.status === "received") verdict = "on_file";
    else if (doc) verdict = "on_file";
    else if (item?.status === "waived") verdict = "waived";
    else if (item) verdict = "missing";
    else verdict = "untracked";

    return {
      slip,
      verdict,
      matchedItemTitle: item?.title ?? null,
      matchedDocumentName: doc?.filename ?? null,
    };
  });

  // Reverse check: slip-shaped items (their title names a slip family) that no
  // pasted CRA slip corroborates. Non-slip items (NOA, receipts) stay out.
  const coveredMatchers = new Set(
    slips.map((s) => matcherFor(s.slipType)?.prefix ?? s.slipType)
  );
  const itemsNotInCra = items
    .filter((i) => {
      const itemMatcher = SLIP_MATCHERS.find((m) => m.pattern.test(i.title));
      return itemMatcher && !coveredMatchers.has(itemMatcher.prefix);
    })
    .map((i) => ({ title: i.title, status: i.status }));

  const counts: Record<SlipVerdict, number> = { on_file: 0, missing: 0, waived: 0, untracked: 0 };
  for (const c of comparisons) counts[c.verdict]++;

  return { slips: comparisons, itemsNotInCra, counts };
}

/** A realistic pasteable example for the UI's "Load sample" helper. */
export const AFR_SAMPLE_CSV = `slip type,issuer,amount
T4,Northgate Manufacturing Inc.,62450.00
T5,Scotiabank,312.40
T5,RBC Direct Investing,1208.77
T4A(OAS),Service Canada,8250.00
RRSP,Sun Life Financial,3500.00`;
