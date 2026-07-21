import { describe, expect, it } from "vitest";
import { decryptField, encryptField, isValidSin, maskSin } from "@/lib/crypto";

describe("field encryption (SIN)", () => {
  it("round-trips and never stores plaintext", () => {
    const sin = "046454286"; // canonical test SIN (Luhn-valid, fictional)
    const stored = encryptField(sin);
    expect(stored).not.toContain(sin);
    expect(stored.startsWith("k1:")).toBe(true);
    expect(decryptField(stored)).toBe(sin);
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptField("046454286")).not.toBe(encryptField("046454286"));
  });

  it("rejects unknown key ids", () => {
    const stored = encryptField("046454286").replace(/^k1:/, "k9:");
    expect(() => decryptField(stored)).toThrow(/key id/);
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const parts = encryptField("046454286").split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });
});

describe("SIN helpers", () => {
  it("masks to last-3 only", () => {
    expect(maskSin("046 454 286")).toBe("*** *** 286");
  });

  it("Luhn-validates", () => {
    expect(isValidSin("046454286")).toBe(true);
    expect(isValidSin("046454287")).toBe(false);
    expect(isValidSin("12345")).toBe(false);
  });
});
