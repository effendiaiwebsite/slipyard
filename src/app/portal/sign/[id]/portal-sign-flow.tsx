"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { SignaturePad, type SignatureMarkValue } from "@/components/esign/signature-pad";
import {
  declinePortalSignature,
  getPortalSourceUrl,
  submitPortalSignature,
} from "../actions";

/**
 * Portal signing flow (M6, AAA): view the form → sign (draw/type) → confirm.
 * One clear action per screen, big targets, honest outcomes — designed for
 * elderly clients on phones, matching the upload flow.
 */

const btnPrimary =
  "w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60";
const btnChoice =
  "flex w-full items-center gap-4 rounded-xl border-2 border-[#26374a] bg-white p-5 text-left text-lg font-semibold text-[#26374a] hover:bg-slate-50";

export function PortalSignFlow({
  requestId,
  signerName,
}: {
  requestId: string;
  signerName: string;
}) {
  const [mark, setMark] = useState<SignatureMarkValue | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function viewForm() {
    startTransition(async () => {
      const res = await getPortalSourceUrl(requestId);
      if (res.url) window.open(res.url, "_blank", "noopener");
      else setError(res.error ?? "The form isn't available right now.");
    });
  }

  function sign() {
    if (!mark) return;
    startTransition(async () => {
      setError(null);
      const res = await submitPortalSignature(requestId, mark);
      if (res.done) setDone("signed");
      else setError(res.error ?? "Something went wrong. Please try again.");
    });
  }

  function decline() {
    startTransition(async () => {
      setError(null);
      const res = await declinePortalSignature(requestId, reason);
      if (res.done) setDone("declined");
      else setError(res.error ?? "Something went wrong. Please try again.");
    });
  }

  if (done === "signed") {
    return (
      <div className="space-y-6">
        <h2>Thank you — you&apos;re all done!</h2>
        <p>
          Your signature has been sent to your accountant. You don&apos;t need to do anything else.
        </p>
        <Link href="/portal/home" className={btnPrimary + " inline-block text-center"}>
          Back to your portal
        </Link>
      </div>
    );
  }
  if (done === "declined") {
    return (
      <div className="space-y-6">
        <h2>We&apos;ve let your accountant know</h2>
        <p>You chose not to sign right now. Your accountant&apos;s office will follow up with you.</p>
        <Link href="/portal/home" className={btnPrimary + " inline-block text-center"}>
          Back to your portal
        </Link>
      </div>
    );
  }

  if (declining) {
    return (
      <div className="space-y-5">
        <h2>Not ready to sign?</h2>
        <p>That&apos;s okay. Let your accountant know why, and they&apos;ll help.</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="w-full rounded-lg border-2 border-[#26374a] px-4 py-3 text-lg"
          placeholder="Optional — tell them what you need"
        />
        <button className={btnPrimary} onClick={decline} disabled={pending}>
          {pending ? "Sending…" : "Send this to my accountant"}
        </button>
        <button
          className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
          onClick={() => setDeclining(false)}
          disabled={pending}
        >
          Go back
        </button>
        {error && (
          <p role="alert" className="font-semibold text-[#b10e1e]">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button className={btnChoice} onClick={viewForm} disabled={pending}>
        <FileText className="h-7 w-7 shrink-0" aria-hidden />
        <span>
          Read the form first
          <span className="block text-[15px] font-normal text-slate-600">
            Opens the document in a new tab.
          </span>
        </span>
      </button>

      <div className="space-y-3">
        <h2>Your signature</h2>
        <SignaturePad onChange={setMark} defaultTypedName={signerName} variant="portal" />
      </div>

      <button className={btnPrimary} onClick={sign} disabled={!mark || pending}>
        {pending ? "Signing…" : "Sign and send"}
      </button>
      <button
        className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
        onClick={() => setDeclining(true)}
        disabled={pending}
      >
        I&apos;m not ready to sign
      </button>
      {error && (
        <p role="alert" className="font-semibold text-[#b10e1e]">
          {error}
        </p>
      )}
      <p className="text-[15px] text-slate-600">
        By signing, you agree this electronic signature is legally binding, the same as signing on
        paper.
      </p>
    </div>
  );
}
