import { encryptField, isValidSin, maskSin } from "@/lib/crypto";

/**
 * Generic data import (M9, ADR-0033) — the pure parse/map/validate core the
 * wizard and its server actions share.
 *
 * Flow: parse a messy CSV → suggest a source-column → target-field mapping →
 * validate + normalise every row into a staged projection with per-row
 * warnings. SIN is the one sensitive target: it is Luhn-checked and encrypted
 * HERE (buildStagedRows), so plaintext never leaves this function's memory —
 * the staged `mapped` carries only ciphertext + the last-3 mask, and the raw
 * snapshot masks that cell too (iron rule: no plaintext SIN at rest / in logs).
 */

// ---- CSV parsing -------------------------------------------------------------

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";" | "\t";
  warnings: string[];
};

function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(";") && !headerLine.includes(",")) return ";";
  return ",";
}

/**
 * Full-text CSV parser with a small state machine — handles quoted fields
 * containing the delimiter, doubled quotes, and embedded newlines (which the
 * line-based AFR splitter cannot). Rows are padded/truncated to the header
 * width by the caller's mapping (by column name), so ragged rows are fine.
 */
export function parseCsv(text: string): ParsedCsv {
  const warnings: string[] = [];
  const normalized = text.replace(/^﻿/, ""); // strip BOM
  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim().length === 0) {
    return { headers: [], rows: [], delimiter: ",", warnings: ["Nothing to parse — paste or upload a CSV with a header row."] };
  }
  const delimiter = detectDelimiter(firstLine);

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // any char seen in the current record

  const pushField = () => {
    record.push(field.trim());
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"' && normalized[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      started = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === delimiter) {
      pushField();
      started = true;
    } else if (ch === "\r") {
      // handled by the \n branch (CRLF) or as a lone CR record end
      if (normalized[i + 1] !== "\n") pushRecord();
    } else if (ch === "\n") {
      pushRecord();
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field.length > 0 || record.length > 0) pushRecord();

  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, warnings: ["No rows found."] };
  }
  const headers = records[0].map((h) => h.trim());
  // Drop fully-empty trailing rows (common from trailing newlines).
  const rows = records
    .slice(1)
    .filter((r) => r.some((c) => c.trim().length > 0));

  if (rows.length === 0) warnings.push("The CSV has a header row but no data rows.");
  const blankHeaders = headers.filter((h) => h.length === 0).length;
  if (blankHeaders > 0) {
    warnings.push(`${blankHeaders} column${blankHeaders === 1 ? "" : "s"} in the header row ${blankHeaders === 1 ? "has" : "have"} no name — those columns can't be mapped.`);
  }
  return { headers, rows, delimiter, warnings };
}

// ---- target field registry ---------------------------------------------------

export const IGNORE_TARGET = "__ignore__";
export const CUSTOM_PREFIX = "custom:";

export type TargetField = {
  key: string;
  label: string;
  group: "core" | "contact" | "address" | "sensitive";
  required?: boolean;
  hint?: string;
  /** Header names that auto-map to this field (lowercased, punctuation-stripped). */
  aliases: string[];
};

/** Client import targets. `custom:<name>` and IGNORE are handled specially. */
export const CLIENT_TARGET_FIELDS: readonly TargetField[] = [
  { key: "displayName", label: "Name", group: "core", required: true, aliases: ["name", "displayname", "clientname", "fullname", "client"] },
  { key: "type", label: "Type", group: "core", hint: "individual / corporation / trust", aliases: ["type", "clienttype", "kind", "entitytype"] },
  { key: "email", label: "Email", group: "contact", aliases: ["email", "emailaddress", "e-mail", "mail"] },
  { key: "phone", label: "Phone", group: "contact", aliases: ["phone", "phonenumber", "mobile", "cell", "tel", "telephone"] },
  { key: "preferredChannel", label: "Preferred channel", group: "contact", hint: "email / sms / phone / mail", aliases: ["preferredchannel", "channel", "contactpreference", "preferredcontact"] },
  { key: "addressLine1", label: "Address", group: "address", aliases: ["address", "addressline1", "address1", "street", "streetaddress"] },
  { key: "city", label: "City", group: "address", aliases: ["city", "town", "municipality"] },
  { key: "province", label: "Province", group: "address", hint: "2-letter, e.g. ON", aliases: ["province", "prov", "state", "provincecode"] },
  { key: "postalCode", label: "Postal code", group: "address", aliases: ["postalcode", "postal", "zip", "zipcode", "postcode"] },
  { key: "dateOfBirth", label: "Date of birth", group: "core", hint: "individuals", aliases: ["dateofbirth", "dob", "birthdate", "birthday", "born"] },
  { key: "sin", label: "SIN", group: "sensitive", hint: "encrypted on import", aliases: ["sin", "socialinsurancenumber", "sinnumber", "nas"] },
  { key: "tags", label: "Tags", group: "core", hint: "; or , separated", aliases: ["tags", "labels", "categories", "groups"] },
  { key: "assignedAccountantEmail", label: "Assigned accountant (email)", group: "core", hint: "matched to a staff member", aliases: ["assignedaccountant", "accountant", "assignedto", "preparer", "assignedaccountantemail"] },
];

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Suggest a source-header → target-field mapping. Exact/alias matches win;
 * unmatched headers become custom fields (custom:<original header>) so no
 * column is silently dropped — the firm can switch any to Ignore in the UI.
 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    if (!header) continue;
    const norm = normalizeHeader(header);
    const hit = CLIENT_TARGET_FIELDS.find(
      (f) => !used.has(f.key) && (normalizeHeader(f.label) === norm || f.aliases.includes(norm))
    );
    if (hit) {
      mapping[header] = hit.key;
      used.add(hit.key);
    } else {
      mapping[header] = `${CUSTOM_PREFIX}${header}`;
    }
  }
  return mapping;
}

// ---- per-field normalisation -------------------------------------------------

const PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

function normalizeType(raw: string): { value: "individual" | "corporation" | "trust"; warn?: string } {
  const v = raw.toLowerCase().trim();
  if (!v) return { value: "individual" };
  if (/(indiv|person|personal|t1|human)/.test(v)) return { value: "individual" };
  if (/(corp|company|inc|ltd|business|t2)/.test(v)) return { value: "corporation" };
  if (/(trust|estate|t3)/.test(v)) return { value: "trust" };
  return { value: "individual", warn: `Unknown client type "${raw}" — defaulted to Individual.` };
}

function normalizeChannel(raw: string): { value: "email" | "sms" | "phone" | "mail"; warn?: string } {
  const v = raw.toLowerCase().trim();
  if (!v) return { value: "phone" };
  if (/(email|e-mail|mail@|electronic)/.test(v) && !/(postal|snail)/.test(v)) return { value: "email" };
  if (/(sms|text)/.test(v)) return { value: "sms" };
  if (/(phone|call|tel|voice)/.test(v)) return { value: "phone" };
  if (/(mail|post|letter)/.test(v)) return { value: "mail" };
  return { value: "phone", warn: `Unknown preferred channel "${raw}" — defaulted to Phone.` };
}

/** Best-effort phone normalisation to E.164 for North America. */
function normalizePhone(raw: string): { value: string | null; warn?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus && digits.length >= 8) return { value: `+${digits}` };
  if (digits.length === 10) return { value: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { value: `+${digits}` };
  return { value: trimmed, warn: `Phone "${raw}" isn't a recognisable number — imported as-is; fix it on the client later.` };
}

/** Parse common date formats to ISO yyyy-mm-dd. Ambiguous d/m order resolved conservatively. */
function normalizeDob(raw: string): { value: string | null; warn?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  // ISO first: yyyy-mm-dd or yyyy/mm/dd
  let m = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return isoOrWarn(+m[1], +m[2], +m[3], raw);
  // dd/mm/yyyy or mm/dd/yyyy — prefer dd/mm when the first part can't be a month
  m = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return isoOrWarn(y, b, a, raw);
    if (b > 12 && a <= 12) return isoOrWarn(y, a, b, raw);
    // both <= 12: ambiguous — assume day/month (common in CA) and note it
    return isoOrWarn(y, b, a, raw, `Date "${raw}" is ambiguous — read as day/month/year.`);
  }
  return { value: null, warn: `Couldn't read date of birth "${raw}" — left blank.` };
}

function isoOrWarn(y: number, mo: number, d: number, raw: string, ambiguousWarn?: string): { value: string | null; warn?: string } {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) {
    return { value: null, warn: `Date of birth "${raw}" is out of range — left blank.` };
  }
  const iso = `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  if (!isRealIsoDate(iso)) {
    return { value: null, warn: `Date of birth "${raw}" isn't a real calendar date — left blank.` };
  }
  return { value: iso, warn: ambiguousWarn };
}

/**
 * True when `iso` (yyyy-mm-dd) names a date that exists on the calendar.
 * Postgres rejects values like 1990-02-31 at insert, so staged rows must
 * never carry them (also re-checked at commit for batches staged before
 * this validation existed).
 */
export function isRealIsoDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 25);
}

// ---- staging -----------------------------------------------------------------

/** The normalised, commit-ready projection of one CSV row. */
export type MappedClient = {
  displayName: string | null;
  type: "individual" | "corporation" | "trust";
  email: string | null;
  phone: string | null;
  preferredChannel: "email" | "sms" | "phone" | "mail";
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  dateOfBirth: string | null;
  /** AES-256-GCM ciphertext (or null). Plaintext SIN never appears anywhere. */
  sinEncrypted: string | null;
  sinLast3: string | null;
  tags: string[];
  /** Resolved to an accountant id at commit; a no-match becomes a warning there. */
  assignedAccountantEmail: string | null;
  customFields: Record<string, string>;
};

export type StagedRow = {
  rowNumber: number;
  /** Source cells by header — SIN-mapped cell masked. Safe to persist/show. */
  raw: Record<string, string>;
  mapped: MappedClient;
  warnings: string[];
  action: "create" | "skip";
};

export type StagedResult = {
  rows: StagedRow[];
  createCount: number;
  skipCount: number;
  warningCount: number;
};

/** Which source header (if any) is mapped to a given target key. */
function sourceHeaderFor(mapping: Record<string, string>, targetKey: string): string | undefined {
  return Object.keys(mapping).find((h) => mapping[h] === targetKey);
}

/**
 * Build staged rows from a parsed CSV + a source→target mapping. This is the
 * ONLY place SIN plaintext is handled; it is encrypted immediately and the
 * source cell is masked in `raw`, so nothing downstream (DB, logs, preview)
 * ever sees it.
 */
export function buildStagedRows(parsed: ParsedCsv, mapping: Record<string, string>): StagedResult {
  const sinHeader = sourceHeaderFor(mapping, "sin");
  const rows: StagedRow[] = [];
  let createCount = 0;
  let skipCount = 0;
  let warningCount = 0;

  parsed.rows.forEach((cells, idx) => {
    const rowNumber = idx + 1;
    const warnings: string[] = [];
    const byHeader: Record<string, string> = {};
    parsed.headers.forEach((h, i) => {
      if (h) byHeader[h] = (cells[i] ?? "").trim();
    });

    const get = (targetKey: string): string => {
      const h = sourceHeaderFor(mapping, targetKey);
      return h ? (byHeader[h] ?? "") : "";
    };

    const displayNameRaw = get("displayName").trim();
    const type = normalizeType(get("type"));
    if (type.warn) warnings.push(type.warn);
    const channel = normalizeChannel(get("preferredChannel"));
    if (channel.warn) warnings.push(channel.warn);

    const emailRaw = get("email").trim();
    let email: string | null = emailRaw || null;
    if (emailRaw && !EMAIL_RE.test(emailRaw)) {
      warnings.push(`Email "${emailRaw}" doesn't look valid — left blank.`);
      email = null;
    }

    const phone = normalizePhone(get("phone"));
    if (phone.warn) warnings.push(phone.warn);

    const province: string | null = get("province").trim().toUpperCase() || null;
    if (province && !PROVINCES.has(province)) {
      warnings.push(`Province "${province}" isn't a Canadian 2-letter code — imported as-is.`);
    }

    const postalRaw = get("postalCode").trim().toUpperCase();
    let postalCode: string | null = postalRaw || null;
    if (postalRaw && !POSTAL_RE.test(postalRaw)) {
      warnings.push(`Postal code "${postalRaw}" doesn't look valid — imported as-is.`);
    } else if (postalRaw && postalRaw.length === 6) {
      postalCode = `${postalRaw.slice(0, 3)} ${postalRaw.slice(3)}`;
    }

    const dob = normalizeDob(get("dateOfBirth"));
    if (dob.warn) warnings.push(dob.warn);
    if (dob.value && type.value !== "individual") {
      warnings.push("Date of birth ignored — only individuals have one.");
    }

    // SIN — Luhn-checked, encrypted here, masked in raw.
    let sinEncrypted: string | null = null;
    let sinLast3: string | null = null;
    const sinRaw = get("sin").replace(/\s/g, "");
    if (sinRaw) {
      const digits = sinRaw.replace(/\D/g, "");
      if (!isValidSin(digits)) {
        warnings.push("SIN is not a valid 9-digit number — left blank.");
      } else if (type.value !== "individual") {
        warnings.push("SIN ignored — only individuals have one.");
      } else {
        sinEncrypted = encryptField(digits);
        sinLast3 = digits.slice(-3);
      }
    }

    const assignedRaw = get("assignedAccountantEmail").trim().toLowerCase();
    const assignedAccountantEmail = assignedRaw && EMAIL_RE.test(assignedRaw) ? assignedRaw : null;
    if (assignedRaw && !assignedAccountantEmail) {
      warnings.push(`Assigned accountant "${assignedRaw}" isn't an email — left unassigned.`);
    }

    // Custom fields: every custom:<name> mapping with a non-empty cell.
    const customFields: Record<string, string> = {};
    for (const [header, target] of Object.entries(mapping)) {
      if (!target.startsWith(CUSTOM_PREFIX)) continue;
      const name = target.slice(CUSTOM_PREFIX.length).trim();
      const val = (byHeader[header] ?? "").trim();
      if (name && val) customFields[name] = val.slice(0, 500);
    }

    // Raw snapshot with the SIN cell masked (never persist plaintext SIN).
    const raw: Record<string, string> = { ...byHeader };
    if (sinHeader && raw[sinHeader]) {
      const d = raw[sinHeader].replace(/\D/g, "");
      raw[sinHeader] = d.length >= 3 ? maskSin(d) : "***";
    }

    const action: "create" | "skip" = displayNameRaw ? "create" : "skip";
    if (action === "skip") {
      warnings.push("No name in this row — skipped (a client needs a name).");
      skipCount++;
    } else {
      createCount++;
    }
    warningCount += warnings.length;

    rows.push({
      rowNumber,
      raw,
      mapped: {
        displayName: displayNameRaw || null,
        type: type.value,
        email,
        phone: phone.value,
        preferredChannel: channel.value,
        addressLine1: get("addressLine1").trim() || null,
        city: get("city").trim() || null,
        province,
        postalCode,
        dateOfBirth: dob.value && type.value === "individual" ? dob.value : null,
        sinEncrypted,
        sinLast3,
        tags: splitTags(get("tags")),
        assignedAccountantEmail,
        customFields,
      },
      warnings,
      action,
    });
  });

  return { rows, createCount, skipCount, warningCount };
}

/** A deliberately messy sample for the wizard's "Load sample" + the e2e test. */
export const SAMPLE_IMPORT_CSV = `Name,Client Type,Email,Phone,Province,Postal,DOB,SIN,Tags,Referral Source
"Okonkwo, Adaeze",Individual,adaeze@example.com,416-555-0182,ON,M5V 2T6,1975-03-14,046454286,"VIP; Newcomer",Google
Bright Star Holdings Inc.,Corporation,info@brightstar.example,(647) 555 0199,on,M4C1B5,,,Corporate,Referral
Tremblay  Jean,individual,not-an-email,5145550143,QC,H2X 1Y4,02/11/1968,123456789,Seniors,Walk-in
Nadia Rahman,person,nadia@example.com,+1 604 555 0111,BC,V6B 1A1,1990/22/07,046454286,,Website
,individual,ghost@example.com,,ON,,,,,Orphaned row`;
