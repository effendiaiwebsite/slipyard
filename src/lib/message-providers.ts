import "server-only";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "@/lib/env";

/**
 * Raw provider calls (M5) — the only place Twilio/SES wire formats live.
 * Callers (src/lib/messaging.ts) own the outbox bookkeeping; these functions
 * just deliver and report. Never log message bodies here (magic links, OTPs).
 *
 * Twilio goes through its plain REST API via fetch — one form-encoded POST —
 * rather than the SDK; SES uses the AWS SDK (SigV4 signing is not something
 * to hand-roll).
 */

export type DeliveryResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

const TWILIO_TIMEOUT_MS = 15_000;

export async function deliverSms(to: string, body: string): Promise<DeliveryResult> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio is not configured (TWILIO_* in .env.example)" };
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
        signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
      }
    );
    const payload = (await res.json().catch(() => null)) as {
      sid?: string;
      message?: string;
      code?: number;
    } | null;
    if (!res.ok || !payload?.sid) {
      // Twilio's error `message` is safe (no body content) and worth keeping.
      const detail = payload?.message ? `${payload.code ?? res.status}: ${payload.message}` : `HTTP ${res.status}`;
      return { ok: false, error: `Twilio rejected the message (${detail})`.slice(0, 500) };
    }
    return { ok: true, providerMessageId: payload.sid };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error";
    return { ok: false, error: `Twilio request ${reason}` };
  }
}

let sesClient: SESv2Client | null = null;

export async function deliverEmail(
  to: string,
  subject: string,
  body: string
): Promise<DeliveryResult> {
  if (!env.SES_FROM_ADDRESS) {
    return { ok: false, error: "SES is not configured (SES_FROM_ADDRESS in .env.example)" };
  }
  try {
    sesClient ??= new SESv2Client({ region: env.AWS_REGION });
    const res = await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: env.SES_FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: body, Charset: "UTF-8" } },
          },
        },
      })
    );
    return { ok: true, providerMessageId: res.MessageId ?? "unknown" };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "unknown SES error";
    return { ok: false, error: `SES rejected the message (${msg})`.slice(0, 500) };
  }
}
