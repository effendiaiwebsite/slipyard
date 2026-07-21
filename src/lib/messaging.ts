import "server-only";
import { OrgScope } from "@/db/scoped";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Outbound messaging, outbox pattern (§1): every email/SMS lands in the
 * org-scoped `outbox` table. In dev (EMAIL_MODE=outbox / no Twilio keys) the
 * message is "delivered" to the console + table so flows are fully testable
 * offline. Real SES/SMTP/Twilio adapters arrive in M5 and flip the provider.
 *
 * NEVER log message bodies (they carry invite/magic links) — log ids only.
 */

export async function sendEmail(
  scope: OrgScope,
  msg: { to: string; subject: string; body: string; meta?: Record<string, unknown> }
) {
  const provider = env.EMAIL_MODE === "outbox" ? "console" : env.EMAIL_MODE;
  if (env.EMAIL_MODE !== "outbox") {
    // SES/SMTP adapters land in M5; until then everything is outbox-mode.
    logger.warn({ mode: env.EMAIL_MODE }, "EMAIL_MODE set but adapter lands in M5 — using outbox");
  }
  const row = await scope.createOutbox({
    channel: "email",
    toAddress: msg.to,
    subject: msg.subject,
    body: msg.body,
    provider: "console",
    status: "sent",
    meta: msg.meta,
  });
  console.log(`\n[outbox:email] to=${msg.to} subject="${msg.subject}"\n${msg.body}\n`);
  logger.info({ outboxId: row.id, channel: "email", provider }, "message delivered to outbox");
  return row;
}

export async function sendSms(
  scope: OrgScope,
  msg: { to: string; body: string; meta?: Record<string, unknown> }
) {
  if (features.realSms) {
    logger.warn("Twilio keys present but the adapter lands in M5 — using outbox");
  }
  const row = await scope.createOutbox({
    channel: "sms",
    toAddress: msg.to,
    body: msg.body,
    provider: "console",
    status: "sent",
    meta: msg.meta,
  });
  console.log(`\n[outbox:sms] to=${msg.to}\n${msg.body}\n`);
  logger.info({ outboxId: row.id, channel: "sms" }, "message delivered to outbox");
  return row;
}
