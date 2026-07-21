import pino from "pino";
import { env } from "@/lib/env";

/**
 * Structured logging. NEVER log: SIN (even encrypted), portal/invite/signing
 * tokens, presigned URLs, passwords, TOTP secrets. Log ids, not payloads.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["*.token", "*.password", "*.secret", "*.sin", "*.authorization"],
    censor: "[redacted]",
  },
});
