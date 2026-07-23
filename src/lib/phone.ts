/**
 * Forgiving phone input (customer-noted UX polish): staff type numbers in
 * whatever format they have — "(416) 555-0123", "416.555.0123",
 * "1 416 555 0123", "+14165550123" — and forms normalise to E.164 instead
 * of rejecting. Returns null when the digits can't plausibly be a number,
 * so schemas fall through to their own (now rarely seen) format error.
 *
 * Same policy as the import wizard's normalizePhone (src/lib/imports.ts),
 * shared here for interactive forms; kept separate because the importer
 * deliberately keeps unrecognisable values (with a warning) while forms
 * should reject them.
 */
export function normalizePhoneInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** zod preprocess hook: normalise when possible, else pass through untouched
 *  so the schema's regex produces the error message. */
export function phonePreprocess(v: unknown): unknown {
  if (typeof v !== "string" || v.trim() === "") return v;
  return normalizePhoneInput(v) ?? v;
}
