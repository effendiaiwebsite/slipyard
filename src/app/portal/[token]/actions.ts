"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createPortalSession } from "@/lib/portal-context";
import {
  issueOtp,
  markOpenedAndSendOtp,
  validatePortalLink,
  verifyOtp,
  type PortalTokenProblem,
} from "@/lib/portal-tokens";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Magic-link entry actions (M4). Anonymous callers — every action
 * re-validates the raw token from the URL (stateless), and everything is
 * rate-limited per token AND per IP. Error messages stay coarse on purpose.
 */

export type PortalStepResult = {
  error?: string;
  /** Set when the link itself is dead — the UI swaps to a call-the-office screen. */
  dead?: boolean;
  sent?: boolean;
};

const PROBLEM_MESSAGES: Record<PortalTokenProblem, string> = {
  invalid: "This link isn't valid. Please use the newest message from your accountant.",
  revoked: "This link was cancelled by your accountant's office. Call them for a new one.",
  expired: "This link has expired. Call your accountant's office and they'll send a fresh one.",
  locked: "Too many incorrect codes. For your security, call your accountant's office.",
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * "Continue" pressed on the welcome screen: stamp opened_at (starting the
 * 15-minute window) and send the SMS code. A deliberate button press —
 * never the GET — so messenger link-prefetchers can't burn the window or
 * trigger texts.
 */
export async function startPortalOtp(raw: string): Promise<PortalStepResult> {
  const ip = await clientIp();
  if (!rateLimit(`portal-start:${ip}`, 10, 10 * 60 * 1000)) {
    return { error: "Too many attempts from this device. Please wait a few minutes." };
  }

  const validated = await validatePortalLink(raw);
  if (!validated.ok) return { dead: true, error: PROBLEM_MESSAGES[validated.problem] };

  const { token, scope } = validated.value;
  if (!rateLimit(`portal-otp-send:${token.id}`, 4, 15 * 60 * 1000)) {
    return { error: "We just sent a code. Please wait a moment for the text to arrive." };
  }
  await markOpenedAndSendOtp(scope, token);
  return { sent: true };
}

/** "Send a new code" on the code screen. */
export async function resendPortalOtp(raw: string): Promise<PortalStepResult> {
  const ip = await clientIp();
  if (!rateLimit(`portal-start:${ip}`, 10, 10 * 60 * 1000)) {
    return { error: "Too many attempts from this device. Please wait a few minutes." };
  }

  const validated = await validatePortalLink(raw);
  if (!validated.ok) return { dead: true, error: PROBLEM_MESSAGES[validated.problem] };

  const { token, scope } = validated.value;
  if (!rateLimit(`portal-otp-send:${token.id}`, 4, 15 * 60 * 1000)) {
    return { error: "We just sent a code. Please wait a moment for the text to arrive." };
  }
  await issueOtp(scope, token);
  return { sent: true };
}

/** Code submitted. Success sets the session cookie and lands on the home page. */
export async function verifyPortalOtp(
  raw: string,
  _prev: PortalStepResult | null,
  formData: FormData
): Promise<PortalStepResult> {
  const ip = await clientIp();
  if (!rateLimit(`portal-verify:${ip}`, 20, 10 * 60 * 1000)) {
    return { error: "Too many attempts from this device. Please wait a few minutes." };
  }

  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return { error: "Please enter the 6-digit code from the text message." };
  }

  const validated = await validatePortalLink(raw);
  if (!validated.ok) return { dead: true, error: PROBLEM_MESSAGES[validated.problem] };

  const { token, scope } = validated.value;
  const result = await verifyOtp(scope, token, code);
  if (!result.ok) {
    if (result.problem === "wrong_code") {
      return { error: "That code isn't right. Check the newest text message and try again." };
    }
    if (result.problem === "expired_code") {
      return { error: "That code has expired. Press “Send a new code” and we'll text another." };
    }
    return { dead: true, error: PROBLEM_MESSAGES[result.problem] };
  }

  await createPortalSession(result.token);
  redirect("/portal/home");
}
