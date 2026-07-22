import crypto from "node:crypto";

/**
 * Twilio inbound-webhook helpers (M5). Kept free of env/db imports so the
 * signature math and keyword classification are unit-testable.
 *
 * Signature scheme (Twilio docs): base64(HMAC-SHA1(authToken,
 * fullUrl + concat(sortedParamName + value))).
 */

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * Twilio's own opt-out keyword set. Twilio blocks further sends at the
 * carrier level on STOP regardless of what we do — this classification just
 * lets the CRM mirror that state (and honour it before ever calling Twilio).
 */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);

export function classifyInboundSms(body: string): "stop" | "start" | "other" {
  const word = body.trim().toLowerCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return "other";
}
