"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gstClient, gstSummary, gstFilingHistory, gstBreakdown } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { Receipt, Sparkles, AlertTriangle, CheckCircle2, Send } from "lucide-react";

export default function GstPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Bookkeeping · GST/HST</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-500" /> {gstClient.name}
          </h1>
          <p className="text-sm text-slate-600 mt-1">{gstClient.period} · {gstClient.filingFreq} · Province: {gstClient.province}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button>Save draft</Button>
          <Button variant="primary"><Send className="w-4 h-4" /> File via My Business Account</Button>
        </div>
      </div>

      {/* Drift warning */}
      <div className="p-4 rounded-lg bg-amber-50 ring-1 ring-amber-200 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">GST collected drift detected — {gstSummary.driftPct}%</div>
          <div className="text-sm text-amber-800 mt-0.5">
            Q1 GST collected ({fmtCAD(gstSummary.collected)}) implies sales of $109,231; bookkeeping shows $104,890. Difference of $4,341.
          </div>
          <div className="text-xs text-amber-700 mt-1">Likely cause: 3 deposits in March not categorized as sales. <button className="underline font-medium">Open transactions</button></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Period summary */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{gstClient.period} return</CardTitle>
            <Badge tone="warn">Due in 1 day</Badge>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {gstBreakdown.map((r, i) => (
                  <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${r.line.startsWith("Net tax") ? "bg-slate-50 font-semibold" : ""}`}>
                    <td className="px-5 py-3">{r.line}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{fmtCAD(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="border-t border-[var(--color-border)] bg-slate-50/40">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-slate-500">Net tax payable to CRA</div>
                <div className="text-3xl font-bold mt-1">{fmtCAD(gstSummary.netOwing)}</div>
                <div className="text-xs text-slate-500 mt-1">Due {gstSummary.dueDate}</div>
              </div>
              <div className="text-right">
                <Badge tone={gstSummary.paid ? "success" : "warn"}>{gstSummary.paid ? "Paid" : "Not paid"}</Badge>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card className="ring-2 ring-violet-200/70">
            <CardHeader className="bg-violet-50/60">
              <CardTitle className="flex items-center gap-2 text-violet-800"><Sparkles className="w-4 h-4" /> AI suggestions</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div className="p-2.5 rounded-md ring-1 ring-slate-200">
                <div className="text-xs font-semibold">Quick method evaluation</div>
                <div className="text-[11px] text-slate-600 mt-1">If client elected Quick Method (8.8% in ON), Q1 net would have been $9,612 vs current $9,820 — quick method <strong>not</strong> beneficial. Stay on regular.</div>
              </div>
              <div className="p-2.5 rounded-md ring-1 ring-slate-200">
                <div className="text-xs font-semibold">ITC capacity</div>
                <div className="text-[11px] text-slate-600 mt-1">3 vendor receipts marked &quot;personal&quot; this quarter — confirm with client to potentially add $284 in ITCs.</div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Filing history</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {gstFilingHistory.map((f) => (
                <div key={f.period} className="flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium">{f.period}</div>
                    <div className="text-slate-500">filed {f.filed}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{fmtCAD(f.net)}</div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
