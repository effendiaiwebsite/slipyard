"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SignaturePad, type SignatureMarkValue } from "@/components/esign/signature-pad";
import { executeInPersonSignature, getSourceViewUrl } from "../../actions";

/** In-person signing pad + apply (M6). */
export function InPersonSign({
  requestId,
  signerName,
}: {
  requestId: string;
  signerName: string;
}) {
  const router = useRouter();
  const [mark, setMark] = useState<SignatureMarkValue | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply() {
    if (!mark) return;
    startTransition(async () => {
      setError(null);
      const res = await executeInPersonSignature(requestId, mark);
      if (res.error) setError(res.error);
      else router.push(`/app/esign/${requestId}`);
    });
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          startTransition(async () => {
            const res = await getSourceViewUrl(requestId);
            if (res.url) window.open(res.url, "_blank", "noopener");
          })
        }
      >
        View the form
      </Button>

      <SignaturePad onChange={setMark} defaultTypedName={signerName} variant="staff" />

      <Button className="w-full" disabled={!mark || pending} onClick={apply}>
        {pending ? "Applying…" : "Apply signature"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Applying stamps the signature and a timestamped audit page onto a new, permanent copy of the
        document.
      </p>
    </div>
  );
}
