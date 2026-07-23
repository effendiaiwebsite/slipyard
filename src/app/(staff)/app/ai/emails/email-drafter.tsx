"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generateEmailDraft, sendDraftedEmail } from "../actions";

/**
 * Email drafts (M8): generate → review/EDIT → explicitly send (or copy).
 * Nothing leaves the building until the staff member clicks Send, and that
 * send is a plain M5 manual message (messages.send_custom) — the AI has no
 * path to it (ADR-0031).
 */

type Option = { id: string; name: string; hasEmail: boolean };

const selectCls =
  "h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

export function EmailDrafter({ clients }: { clients: Option[] }) {
  const [clientId, setClientId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selected = clients.find((c) => c.id === clientId);

  const generate = () => {
    setError(null);
    setSent(null);
    startTransition(async () => {
      const res = await generateEmailDraft(clientId, instructions);
      if (res.error) setError(res.error);
      else {
        setSubject(res.subject ?? "");
        setBody(res.body ?? "");
        setHasDraft(true);
      }
    });
  };

  const send = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendDraftedEmail(clientId, subject, body);
      if (res.error) setError(res.error);
      else setSent(res.status === "sent" ? "Sent." : `Send recorded (${res.status}).`);
    });
  };

  return (
    <div className="space-y-4" data-testid="email-drafter">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setHasDraft(false);
            setSent(null);
          }}
          className={selectCls}
          aria-label="Client"
        >
          <option value="" disabled>
            Select client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.hasEmail ? "" : " (no email on file)"}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={2}
        placeholder='What should the email say? e.g. "Nudge them gently about the documents we still need."'
        aria-label="Draft instructions"
        className="w-full px-3 py-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none resize-y"
      />

      <Button onClick={generate} disabled={isPending || !clientId || !instructions.trim()}>
        {isPending && !hasDraft ? "Drafting…" : hasDraft ? "Draft again" : "Draft email"}
      </Button>

      {hasDraft && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-4" data-testid="email-draft">
          <p className="text-xs text-slate-500">
            This is a draft — review and edit before anything is sent.
          </p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            className="w-full h-9 px-3 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            aria-label="Email body"
            className="w-full px-3 py-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none resize-y"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={send}
              disabled={isPending || !selected?.hasEmail}
              title={selected?.hasEmail ? undefined : "This client has no email address on file"}
              data-testid="send-draft"
            >
              {isPending ? "Working…" : "Send via Messaging"}
            </Button>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
            >
              {copied ? "Copied" : "Copy draft"}
            </button>
            {sent && (
              <span className="text-sm text-emerald-700" data-testid="send-result">
                {sent}
              </span>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
