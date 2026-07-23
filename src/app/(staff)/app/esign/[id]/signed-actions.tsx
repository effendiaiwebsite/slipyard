"use client";

import { Download, PenLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelSignature, getSignedDownloadUrl } from "../actions";

/**
 * Actions for a sent/viewed/signed request (M6). Sent/viewed: staff can sign
 * in person on this device, or withdraw. Signed: download the executed PDF.
 */
export function SignedActions({
  requestId,
  status,
  canManage,
  signedDocReady,
  canSignInPerson,
}: {
  requestId: string;
  status: string;
  canManage: boolean;
  signedDocReady: boolean;
  canSignInPerson: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2 flex-wrap">
        {status === "signed" && signedDocReady && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await getSignedDownloadUrl(requestId);
                if (res.url) window.open(res.url, "_blank", "noopener");
                else setMsg(res.error ?? null);
              })
            }
          >
            <Download /> Download signed PDF
          </Button>
        )}
        {canSignInPerson && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => router.push(`/app/esign/${requestId}/sign`)}
          >
            <PenLine /> Sign in person
          </Button>
        )}
        {canManage && (status === "sent" || status === "viewed") && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await cancelSignature(requestId);
                if (res.error) setMsg(res.error);
                else router.refresh();
              })
            }
          >
            <X /> Withdraw
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
