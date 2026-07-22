"use client";

import { Ban, Link2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { issuePortalLink, revokePortalLink } from "../portal-actions";

/**
 * "Portal access" card on the client detail page: issue a magic link to the
 * client (or a trusted helper) and see/revoke the links already out there.
 * The raw link never reaches this component — it goes out via SMS/email
 * (outbox in dev).
 */

type ActionResult = { error?: string; ok?: boolean } | null;

export type PortalLinkView = {
  id: string;
  recipientName: string;
  phoneTail: string; // last 4 digits only — full numbers stay server-side
  isHelper: boolean;
  helperRelationship: string | null;
  includeHousehold: boolean;
  status: "sent" | "opened" | "in_use" | "expired" | "revoked" | "locked";
  expiresAt: string; // formatted server-side
  createdByName: string | null;
};

const STATUS_META: Record<PortalLinkView["status"], { label: string; variant?: "accent" | "success" | "warn" | "danger" }> = {
  sent: { label: "Sent — not opened", variant: "accent" },
  opened: { label: "Opened", variant: "warn" },
  in_use: { label: "In use", variant: "success" },
  expired: { label: "Expired" },
  revoked: { label: "Revoked" },
  locked: { label: "Locked (wrong codes)", variant: "danger" },
};

export function PortalAccessCard({
  clientId,
  clientPhone,
  hasHousehold,
  canManage,
  links,
}: {
  clientId: string;
  clientPhone: string | null;
  hasHousehold: boolean;
  canManage: boolean;
  links: PortalLinkView[];
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-3">
      {links.length === 0 && (
        <p className="text-sm text-slate-400">No portal links sent yet.</p>
      )}
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.id} className="text-sm flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-800">{l.recipientName}</span>
                {l.isHelper && (
                  <span className="text-xs text-slate-500">
                    helper{l.helperRelationship ? ` — ${l.helperRelationship}` : ""}
                  </span>
                )}
                <Badge variant={STATUS_META[l.status].variant}>{STATUS_META[l.status].label}</Badge>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                to ···{l.phoneTail}
                {l.includeHousehold && " · whole household"} · until {l.expiresAt}
                {l.createdByName && ` · by ${l.createdByName}`}
              </div>
            </div>
            {canManage && (l.status === "sent" || l.status === "opened" || l.status === "in_use") && (
              <RevokeButton tokenId={l.id} />
            )}
          </li>
        ))}
      </ul>

      {canManage && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          <Link2 /> Send portal link
        </Button>
      )}
      {canManage && showForm && (
        <IssueForm
          clientId={clientId}
          clientPhone={clientPhone}
          hasHousehold={hasHousehold}
          onDone={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function RevokeButton({ tokenId }: { tokenId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      title="Revoke this link"
      disabled={isPending}
      onClick={() => startTransition(() => void revokePortalLink(tokenId))}
      className="text-slate-400 hover:text-red-600 disabled:opacity-50 shrink-0 mt-0.5"
    >
      <Ban className="w-3.5 h-3.5" />
    </button>
  );
}

function IssueForm({
  clientId,
  clientPhone,
  hasHousehold,
  onDone,
}: {
  clientId: string;
  clientPhone: string | null;
  hasHousehold: boolean;
  onDone: () => void;
}) {
  const [recipient, setRecipient] = useState<"client" | "helper">("client");
  const [state, formAction, pending] = useActionState(
    async (prev: ActionResult, fd: FormData) => {
      const res = await issuePortalLink(clientId, prev, fd);
      if (res?.ok) onDone();
      return res;
    },
    null
  );

  return (
    <form action={formAction} className="space-y-2 rounded-md bg-slate-50 ring-1 ring-slate-200 p-3">
      <div className="flex items-center gap-4 text-xs text-slate-700">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="recipient"
            value="client"
            checked={recipient === "client"}
            onChange={() => setRecipient("client")}
          />
          To the client
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="recipient"
            value="helper"
            checked={recipient === "helper"}
            onChange={() => setRecipient("helper")}
          />
          To a trusted helper
        </label>
      </div>

      {recipient === "helper" && (
        <div className="flex gap-2">
          <Input name="recipientName" required placeholder="Helper's name" className="h-8 text-xs" />
          <Input
            name="helperRelationship"
            placeholder="Relationship (e.g. daughter)"
            className="h-8 text-xs"
          />
        </div>
      )}

      <Input
        name="recipientPhone"
        required
        defaultValue={recipient === "client" ? (clientPhone ?? "") : ""}
        key={recipient} // reset the default when switching recipient
        placeholder="Mobile number, e.g. +14165550123"
        className="h-8 text-xs"
      />

      {hasHousehold && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" name="includeHousehold" className="rounded" />
          Allow documents for the whole household
        </label>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send link"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
      <p className="text-[11px] text-slate-500">
        The link is texted to this number (and emailed to the client when we have an address). It
        lasts 7 days, dies 15 minutes after it&apos;s first opened, and needs a texted security
        code to get in.
      </p>
    </form>
  );
}
