"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { afrSummary, afrMismatchList } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { GitCompare, RefreshCw, Sparkles, AlertCircle, CheckCircle2, Clock } from "lucide-react";

const actionMeta: Record<string, { label: string; tone: "warn" | "success" | "info" | "ai" }> = {
  request: { label: "Request from client", tone: "warn" },
  wait: { label: "Wait for AFR update", tone: "info" },
  resolved: { label: "Reconciled", tone: "success" },
  auto: { label: "Auto-included", tone: "ai" },
};

const toneClasses: Record<string, string> = {
  warn: "text-amber-600", success: "text-emerald-600", info: "text-sky-600", ai: "text-violet-600",
  neutral: "text-slate-500", danger: "text-rose-600",
};

export default function AfrPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Tax · AFR reconciliation</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-slate-500" /> AFR reconciliation
          </h1>
          <p className="text-sm text-slate-600 mt-1">Cross-checks every open T1 against CRA Auto-fill data · last sync 14 min ago</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><RefreshCw className="w-4 h-4" /> Refresh AFR</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Auto-resolve all</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {afrSummary.map((k) => (
          <Card key={k.label}>
            <CardBody className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">{k.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className={`text-xs ${toneClasses[k.tone]}`}>{k.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mismatches across all open T1s</CardTitle>
          <Badge tone="warn">{afrMismatchList.filter((m) => m.action !== "resolved").length} open</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-left font-medium px-3 py-2.5">Slip</th>
                <th className="text-left font-medium px-3 py-2.5">Line</th>
                <th className="text-right font-medium px-3 py-2.5">Amount</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="text-left font-medium px-3 py-2.5">Resolution</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {afrMismatchList.map((m, i) => {
                const meta = actionMeta[m.action];
                return (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium">{m.client}</td>
                    <td className="px-3 py-3 text-slate-700">{m.slip}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 font-mono">{m.line}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{fmtCAD(m.amount)}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{m.status}</td>
                    <td className="px-3 py-3"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                    <td className="px-3 py-3 text-right">
                      {m.action === "request" && (
                        <Button variant="ai" className="text-xs py-1 px-2">Send request</Button>
                      )}
                      {m.action === "wait" && <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> waiting</span>}
                      {m.action === "resolved" && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> done</span>}
                      {m.action === "auto" && <span className="text-xs text-violet-600 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> auto</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> How AFR reconciliation works</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-slate-600 space-y-2">
          <p>For each open T1, we pull AFR via your Represent a Client credentials and compare every slip line-by-line against the documents the client uploaded.</p>
          <ul className="space-y-1.5 mt-3 list-disc pl-5">
            <li>Slips on AFR but missing from client docs → flagged for follow-up</li>
            <li>Slips in client docs but not on AFR → likely first-60-days RRSP or out-of-province T-slips, marked &quot;wait&quot;</li>
            <li>Amount discrepancies &gt; $5 → highlighted with both values for review</li>
            <li>Cleared / zero-amount slips automatically resolved</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
