"use client";

import { Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildTemplateVars, renderTemplate } from "@/lib/templates";
import { sendMassMessage, type MassSendResult } from "./actions";

/**
 * Mass-send composer (M5): filter clients → pick a template → preview →
 * send. Filtering/selection is client-side over the org's (scoped) list —
 * same small-firm-scale call the clients grid makes. The server action
 * re-resolves recipients, consent and channels authoritatively.
 */

export type TemplateOption = {
  id: string;
  name: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
};

export type RecipientRow = {
  id: string;
  name: string;
  type: "individual" | "corporation" | "trust";
  hasEmail: boolean;
  hasPhone: boolean;
  smsOptedOut: boolean;
  stageCategory: string | null;
  stageLabel: string | null;
  taxYear: number | null;
  missingTitles: string[];
  accountantName: string | null;
};

const selectCls =
  "h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

const CATEGORY_LABELS: Record<string, string> = {
  not_started: "Not started",
  awaiting_docs: "Awaiting documents",
  in_progress: "In progress",
  awaiting_signature: "Awaiting signature",
  filed: "Filed",
  complete: "Complete",
};

export function MassSendComposer({
  templates,
  recipients,
  firmName,
  canSend,
}: {
  templates: TemplateOption[];
  recipients: RecipientRow[];
  firmName: string;
  canSend: boolean;
}) {
  const [templateId, setTemplateId] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<MassSendResult | null>(null);
  const [pending, startTransition] = useTransition();

  const template = templates.find((t) => t.id === templateId) ?? null;

  const filtered = useMemo(
    () =>
      recipients.filter(
        (r) =>
          (!category || r.stageCategory === category) &&
          (!type || r.type === type) &&
          (!missingOnly || r.missingTitles.length > 0)
      ),
    [recipients, category, type, missingOnly]
  );

  const reachable = (r: RecipientRow) =>
    template === null
      ? true
      : template.channel === "email"
        ? r.hasEmail
        : r.hasPhone && !r.smsOptedOut;

  const chosen = filtered.filter((r) => selected.has(r.id));
  const previewFor = chosen.find(reachable) ?? chosen[0] ?? null;
  const preview =
    template && previewFor
      ? (() => {
          const vars = buildTemplateVars({
            clientName: previewFor.name,
            firmName,
            taxYear: previewFor.taxYear,
            missingDocs: previewFor.missingTitles,
            accountantName: previewFor.accountantName,
          });
          return {
            subject: template.subject ? renderTemplate(template.subject, vars).text : null,
            body: renderTemplate(template.body, vars).text,
          };
        })()
      : null;

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))
    );
  }

  function send() {
    if (!template || chosen.length === 0) return;
    startTransition(async () => {
      setResult(await sendMassMessage(template.id, [...chosen.map((r) => r.id)]));
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectCls} aria-label="Template">
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.channel === "email" ? "email" : "text"})
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} aria-label="Stage filter">
          <option value="">Any stage</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls} aria-label="Type filter">
          <option value="">Any type</option>
          <option value="individual">Individuals</option>
          <option value="corporation">Corporations</option>
          <option value="trust">Trusts</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} className="rounded" />
          Missing documents only
        </label>
      </div>

      <div className="rounded-md ring-1 ring-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
        <label className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 bg-slate-50 sticky top-0">
          <input
            type="checkbox"
            checked={filtered.length > 0 && selected.size === filtered.length}
            onChange={toggleAll}
            className="rounded"
            aria-label="Select all"
          />
          {filtered.length} client{filtered.length === 1 ? "" : "s"} match · {chosen.length} selected
        </label>
        {filtered.map((r) => (
          <label key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(r.id);
                else next.delete(r.id);
                setSelected(next);
              }}
              className="rounded"
            />
            <span className="text-slate-800">{r.name}</span>
            {r.stageLabel && <span className="text-xs text-slate-400">{r.stageLabel}</span>}
            {r.missingTitles.length > 0 && (
              <Badge variant="warn">{r.missingTitles.length} missing</Badge>
            )}
            <span className="flex-1" />
            {template && !reachable(r) && (
              <Badge variant="danger">
                {template.channel === "sms" && r.smsOptedOut ? "opted out of texts" : "no address"}
              </Badge>
            )}
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-sm text-slate-400">No clients match these filters.</p>
        )}
      </div>

      {preview && (
        <div className="rounded-md bg-slate-50 ring-1 ring-slate-200 p-3 space-y-1">
          <p className="text-xs text-slate-500">
            Preview for {previewFor!.name} — each client gets their own details filled in.
          </p>
          {preview.subject && <p className="text-sm font-medium text-slate-800">{preview.subject}</p>}
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{preview.body}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button disabled={!canSend || pending || !template || chosen.length === 0} onClick={send}>
          <Send /> {pending ? "Sending…" : `Send to ${chosen.length} client${chosen.length === 1 ? "" : "s"}`}
        </Button>
        {result?.ok && (
          <span className="text-sm text-emerald-700">
            Queued {result.queued} message{result.queued === 1 ? "" : "s"}
            {result.skipped ? ` · ${result.skipped} skipped (no address or opted out)` : ""} — see the log below.
          </span>
        )}
        {result?.error && <span className="text-sm text-red-600">{result.error}</span>}
      </div>
    </div>
  );
}
