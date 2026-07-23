import { describe, expect, it } from "vitest";
import { normalizePhoneInput, phonePreprocess } from "@/lib/phone";

/** Forgiving phone entry (post-M10 UX polish, customer-noted). */
describe("normalizePhoneInput", () => {
  it("accepts every common Canadian format", () => {
    for (const raw of [
      "4165550123",
      "416-555-0123",
      "416.555.0123",
      "(416) 555-0123",
      "416 555 0123",
      "1 416 555 0123",
      "1-416-555-0123",
      "+1 (416) 555-0123",
      "+14165550123",
    ]) {
      expect(normalizePhoneInput(raw), raw).toBe("+14165550123");
    }
  });

  it("keeps international numbers with an explicit +", () => {
    expect(normalizePhoneInput("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects what can't be a number", () => {
    for (const raw of ["555-0123", "12345", "not a phone", "+1 234"]) {
      expect(normalizePhoneInput(raw), raw).toBeNull();
    }
  });

  it("preprocess passes empty and unrecognisable values through for the schema to judge", () => {
    expect(phonePreprocess("")).toBe("");
    expect(phonePreprocess("garbage")).toBe("garbage");
    expect(phonePreprocess("(416) 555-0123")).toBe("+14165550123");
    expect(phonePreprocess(undefined)).toBeUndefined();
  });
});
