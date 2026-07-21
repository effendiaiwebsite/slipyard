import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Field-level encryption for SIN (and future sensitive scalars).
 * AES-256-GCM; ciphertext format:  <keyId>:<iv b64>:<tag b64>:<ct b64>
 * The key-id prefix ("k1") supports rotation: add k2 to the keyring, new
 * writes use it, old rows decrypt with k1 until re-encrypted.
 *
 * SIN handling rules (§6): app-layer encrypted at rest, masked on display
 * (maskSin), never in logs, URLs, or exports.
 */

const KEYRING: Record<string, Buffer> = {
  k1: Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64"),
};
const CURRENT_KEY_ID = "k1";

if (KEYRING[CURRENT_KEY_ID].length !== 32) {
  throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEYRING[CURRENT_KEY_ID], iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CURRENT_KEY_ID, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptField(stored: string): string {
  const [keyId, ivB64, tagB64, ctB64] = stored.split(":");
  const key = KEYRING[keyId];
  if (!key) throw new Error(`Unknown field-encryption key id '${keyId}'`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** "123456789" -> "*** *** 789" — the only shape a SIN ever renders in. */
export function maskSin(sin: string): string {
  const digits = sin.replace(/\D/g, "");
  return `*** *** ${digits.slice(-3)}`;
}

/** Luhn check used by the import wizard and client forms (SINs are Luhn-valid). */
export function isValidSin(sin: string): boolean {
  const digits = sin.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
