"use client";

import { useActionState, useState, useTransition } from "react";
import {
  resendPortalOtp,
  startPortalOtp,
  verifyPortalOtp,
  type PortalStepResult,
} from "./actions";

/**
 * Two-step entry flow: welcome → texted code. Big type, one primary action
 * per screen, no jargon (AAA portal rules). The raw token stays in the URL;
 * actions re-validate it server-side every time.
 */
export function OtpFlow({
  raw,
  recipientName,
  phoneTail,
  alreadyOpened,
}: {
  raw: string;
  recipientName: string;
  phoneTail: string;
  alreadyOpened: boolean;
}) {
  // If the link was opened before (e.g. page refresh mid-flow) go straight
  // to the code screen — a fresh code is one button press away.
  const [step, setStep] = useState<"welcome" | "code">(alreadyOpened ? "code" : "welcome");
  const [dead, setDead] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  const [verifyState, verifyAction, verifying] = useActionState(
    (prev: PortalStepResult | null, fd: FormData) => verifyPortalOtp(raw, prev, fd),
    null
  );
  // A dead verdict can arrive from either the start actions (state) or the
  // verify action (derived) — first one wins.
  const deadMessage =
    dead ?? (verifyState?.dead ? (verifyState.error ?? "This link no longer works.") : null);

  const begin = (action: (raw: string) => Promise<PortalStepResult>) =>
    startTransition(async () => {
      setStartError(null);
      const res = await action(raw);
      if (res.dead) setDead(res.error ?? "This link no longer works.");
      else if (res.error) setStartError(res.error);
      else setStep("code");
    });

  if (deadMessage) {
    return (
      <div className="space-y-6">
        <h1>This link no longer works</h1>
        <p>{deadMessage}</p>
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="space-y-6">
        <h1>Hello {recipientName}</h1>
        <p>
          This is your accountant&apos;s secure portal. To keep your documents safe, we&apos;ll
          text a 6-digit code to your phone ending in <strong>{phoneTail}</strong>.
        </p>
        <button
          onClick={() => begin(startPortalOtp)}
          disabled={starting}
          className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60"
        >
          {starting ? "Sending your code…" : "Continue — text me the code"}
        </button>
        {startError && (
          <p role="alert" className="font-semibold text-[#b10e1e]">
            {startError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1>Enter your code</h1>
      <p>
        We texted a 6-digit code to your phone ending in <strong>{phoneTail}</strong>. It can take
        a minute to arrive.
      </p>
      <form action={verifyAction} className="space-y-4">
        <label htmlFor="portal-otp" className="block font-semibold">
          Your 6-digit code
        </label>
        <input
          id="portal-otp"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="w-full rounded-lg border-2 border-[#26374a] px-4 py-4 text-center text-3xl tracking-[0.5em] font-mono"
        />
        {verifyState?.error && !verifyState.dead && (
          <p role="alert" className="font-semibold text-[#b10e1e]">
            {verifyState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={verifying}
          className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60"
        >
          {verifying ? "Checking…" : "Open my portal"}
        </button>
      </form>
      <button
        onClick={() => begin(resendPortalOtp)}
        disabled={starting}
        className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50 disabled:opacity-60"
      >
        {starting ? "Sending…" : "Send a new code"}
      </button>
      {startError && (
        <p role="alert" className="font-semibold text-[#b10e1e]">
          {startError}
        </p>
      )}
    </div>
  );
}
