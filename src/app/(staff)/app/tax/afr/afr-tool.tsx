"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AFR_SAMPLE_CSV } from "@/lib/afr";
import { runAfrCompare, trackSlipAsChecklistItem, type AfrCompareResult } from "./actions";

/**
 * AFR reconciliation tool: pick a client + year, paste the CRA slip CSV the
 * tax software exported, compare. Mismatches surface in four buckets; each
 * untracked slip offers a one-click "Track on checklist".
 */

type Option = { id: string; name: string };

const VERDICT_META: Record<
  "on_file" | "missing" | "waived" | "untracked",
  { label: string; variant: "success" | "warn" | "danger" | "accent"; blurb: string }
> = {
  on_file: { label: "On file", variant: "success", blurb: "we already have it" },
  missing: { label: "Missing", variant: "warn", blurb: "tracked but not received" },
  waived: { label: "Waived", variant: "danger", blurb: "marked not-needed, yet the CRA has it" },
  untracked: { label: "Not tracked", variant: "danger", blurb: "nothing on the checklist covers it" },
};

const selectCls =
  "h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

export function AfrTool({ clients, defaultYear }: { clients: Option[]; defaultYear: number }) {
  const [state, formAction, pending] = useActionState(runAfrCompare, null);
  const csvRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select name="clientId" required className={selectCls} defaultValue="">
            <option value="" disabled>
              Select client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            name="taxYear"
            type="number"
            defaultValue={defaultYear}
            min={2000}
            max={2100}
            className="h-9 w-24 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none"
            aria-label="Tax year"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Comparing…" : "Compare"}
          </Button>
          <button
            type="button"
            onClick={() => {
              if (csvRef.current) csvRef.current.value = AFR_SAMPLE_CSV;
            }}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Load sample CSV
          </button>
        </div>
        <textarea
          ref={csvRef}
          name="csv"
          required
          rows={8}
          placeholder={
            "Paste the CRA slip CSV from your tax software's AFR download, e.g.\n\n" +
            "slip type,issuer,amount\nT4,Employer Inc.,62450.00\nT5,Big Bank,312.40"
          }
          className="w-full px-3 py-2 text-sm font-mono rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none resize-y"
        />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>

      {state?.ok && state.comparison && (
        <AfrResults key={`${state.engagementId}-${state.taxYear}`} result={state} />
      )}
    </div>
  );
}

function AfrResults({ result }: { result: AfrCompareResult }) {
  const comparison = result.comparison!;
  const [tracked, setTracked] = useState<Set<number>>(new Set());
  const [trackError, setTrackError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const mismatches =
    comparison.counts.missing + comparison.counts.waived + comparison.counts.untracked;

  return (
    <div className="space-y-4" data-testid="afr-results">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium">
          {result.clientName} — {result.taxYear}:
        </span>
        <span>
          {comparison.slips.length} CRA slip{comparison.slips.length === 1 ? "" : "s"},{" "}
          {mismatches === 0 ? (
            <span className="text-emerald-700 font-medium">everything reconciles</span>
          ) : (
            <span className="text-amber-700 font-medium">
              {mismatches} mismatch{mismatches === 1 ? "" : "es"}
            </span>
          )}
        </span>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-0.5">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
              <th className="py-2 pr-3 font-medium">CRA slip</th>
              <th className="py-2 pr-3 font-medium">Issuer</th>
              <th className="py-2 pr-3 font-medium">Verdict</th>
              <th className="py-2 pr-3 font-medium">Matched to</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {comparison.slips.map((s, i) => {
              const meta = VERDICT_META[s.verdict];
              return (
                <tr
                  key={i}
                  data-testid={`afr-slip-${s.verdict}`}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="py-2 pr-3 font-mono text-xs">{s.slip.slipType}</td>
                  <td className="py-2 pr-3 text-slate-600">{s.slip.issuer || "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={meta.variant} title={meta.blurb}>
                      {meta.label}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {s.matchedItemTitle ?? s.matchedDocumentName ?? "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {s.verdict === "untracked" &&
                      (tracked.has(i) ? (
                        <span className="text-xs text-emerald-700">Added to checklist</span>
                      ) : (
                        <button
                          disabled={isPending}
                          onClick={() =>
                            startTransition(async () => {
                              setTrackError(null);
                              const res = await trackSlipAsChecklistItem(
                                result.engagementId!,
                                s.slip.slipType,
                                s.slip.issuer
                              );
                              if (res.error) setTrackError(res.error);
                              else setTracked((prev) => new Set(prev).add(i));
                            })
                          }
                          className="text-xs text-indigo-700 hover:underline underline-offset-2 disabled:opacity-50"
                        >
                          Track on checklist
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trackError && <p className="text-sm text-red-600">{trackError}</p>}

      {comparison.itemsNotInCra.length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-1">On our checklist, but not in the CRA data</div>
          <p className="text-xs text-slate-500 mb-2">
            The CRA download doesn&apos;t always include everything (some slips arrive late) —
            treat these as &quot;double-check&quot;, not errors.
          </p>
          <ul className="space-y-1">
            {comparison.itemsNotInCra.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge>{item.status}</Badge>
                <span className="text-slate-700">{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
