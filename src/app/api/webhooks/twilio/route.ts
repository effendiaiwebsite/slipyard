import { NextResponse } from "next/server";
import { OrgScope, findClientsByPhone } from "@/db/scoped";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { classifyInboundSms, validateTwilioSignature } from "@/lib/twilio-webhook";

/**
 * Twilio inbound SMS webhook (M5): STOP/START consent mirroring. Twilio
 * already blocks sends to STOPped numbers at the carrier level; this keeps
 * the CRM's own state (client.sms_opt_out_at) in step so reminders and mass
 * sends skip the number before ever reaching a provider.
 *
 * Identity: the X-Twilio-Signature HMAC (auth token) is the credential —
 * same posture as the Stripe webhook. The sender's org is unknowable from
 * an SMS, so the phone number is matched across ALL orgs (a client of two
 * firms who texts STOP opts out of both — the safer reading) via the
 * client_by_phone RLS policy (0016).
 */

const twiml = () =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

export async function POST(request: Request) {
  if (!env.TWILIO_AUTH_TOKEN) {
    return NextResponse.json({ error: "Twilio is not configured." }, { status: 503 });
  }

  let params: Record<string, string>;
  try {
    params = Object.fromEntries(
      [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)])
    );
  } catch {
    return NextResponse.json({ error: "Expected a form-encoded request." }, { status: 400 });
  }

  // Twilio signs the URL it was configured with — the public APP_URL.
  const url = new URL("/api/webhooks/twilio", env.APP_URL).toString();
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!validateTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, signature)) {
    logger.warn("twilio webhook signature validation failed");
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  const from = params.From ?? "";
  const keyword = classifyInboundSms(params.Body ?? "");
  if (!from || keyword === "other") return twiml();

  const optingOut = keyword === "stop";
  const matches = await findClientsByPhone(from);
  for (const match of matches) {
    const already = optingOut ? match.smsOptOutAt !== null : match.smsOptOutAt === null;
    if (already) continue;
    const scope = new OrgScope(match.orgId, null);
    await scope.setClientSmsOptOut(match.id, optingOut);
    await scope.writeAudit({
      actorType: "client",
      action: optingOut ? "messages.sms_opt_out" : "messages.sms_opt_in",
      resourceType: "client",
      resourceId: match.id,
      details: { source: "twilio_webhook", keyword: params.Body?.trim().toUpperCase() },
    });
    await scope.addContactLog({
      clientId: match.id,
      channel: "sms",
      summary: optingOut
        ? "Texted STOP — opted out of text messages."
        : "Texted START — opted back in to text messages.",
    });
  }
  logger.info({ matches: matches.length, optingOut }, "twilio consent webhook processed");
  return twiml();
}
