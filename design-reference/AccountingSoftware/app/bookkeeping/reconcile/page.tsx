"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reconciliation, bookClient } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { Scale, CheckCircle2, AlertCircle, Sparkles, RefreshCw } from "lucide-react";

const suggestionTone: Record<string, "ai" | "warn" | "info"> = {
  "auto-match": "ai",
  "review — same amt as cheque #1037": "warn",
  "create JE: Bank fees": "info",
  "create JE: Interest income": "info",
};

export default function ReconcilePage() {
  const diff = reconciliation.bankBalance - reconciliation.ledgerBalance;
  const outstandingTotal = reconciliation.outstanding.reduce((s, o) => s + o.amount, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Bookkeeping · Reconciliation</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="w-5 h-5 text-slate-500" /> {bookClient.name}
          </h1>
          <p className="text-sm text-slate-600 mt-1">{bookClient.account} · April 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><RefreshCw className="w-4 h-4" /> Re-pull statement</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Auto-match all</Button>
          <Button variant="primary">Sign off</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500 font-medium">Bank statement</div>
            <div className="text-2xl font-semibold tracking-tight mt-1">{fmtCAD(reconciliation.bankBalance)}</div>
            <div className="text-xs text-slate-500 mt-0.5">as of Apr 30, 2026</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500 font-medium">General ledger</div>
            <div className="text-2xl font-semibold tracking-tight mt-1">{fmtCAD(reconciliation.ledgerBalance)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{reconciliation.cleared} cleared transactions</div>
          </CardBody>
        </Card>
        <Card className="ring-2 ring-amber-200">
          <CardBody>
            <div className="text-xs text-amber-700 font-medium">Difference</div>
            <div className="text-2xl font-semibold tracking-tight mt-1 text-amber-700">{fmtCAD(diff)}</div>
            <div className="text-xs text-amber-600 mt-0.5">{reconciliation.outstanding.length} outstanding items explain {fmtCAD(outstandingTotal)}</div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> Outstanding items</CardTitle>
          <Badge tone="ai">AI-matched</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Date</th>
                <th className="text-left font-medium px-3 py-2.5">Description</th>
                <th className="text-right font-medium px-3 py-2.5">Amount</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">AI suggestion</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.outstanding.map((o, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-600 font-mono text-xs">{o.date}</td>
                  <td className="px-3 py-3 font-medium">{o.desc}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${o.amount > 0 ? "text-emerald-700" : "text-slate-700"}`}>
                    {o.amount > 0 ? "+" : ""}{fmtCAD(o.amount)}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{o.type}</td>
                  <td className="px-3 py-3 text-xs">
                    <Badge tone={suggestionTone[o.suggestion] ?? "info"}>
                      <Sparkles className="w-2.5 h-2.5" /> {o.suggestion}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="ai" className="text-xs py-1 px-2">Apply</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Period close — April 2026</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-slate-600">
          Once you sign off, the balance is locked and a snapshot is added to the audit trail. Reviewer: Sarah Kovac.
        </CardBody>
      </Card>
    </div>
  );
}
