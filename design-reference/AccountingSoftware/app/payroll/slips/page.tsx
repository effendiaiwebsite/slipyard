"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { slipKpis, slipRows, bookClient } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { FileSpreadsheet, Send, Download, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";

const statusTone: Record<string, "success" | "warn" | "neutral"> = {
  ready: "success", warning: "warn", "ROE filed": "neutral",
};

const toneClasses: Record<string, string> = {
  success: "text-emerald-600", neutral: "text-slate-500", ai: "text-violet-600",
};

export default function SlipsPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Payroll · Year-end slips</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-slate-500" /> 2025 T4 / T4A
          </h1>
          <p className="text-sm text-slate-600 mt-1">{bookClient.name} · CRA deadline Feb 28, 2026 (filed)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Download className="w-4 h-4" /> Download all (PDF)</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Reconcile to GL</Button>
          <Button variant="primary"><Send className="w-4 h-4" /> Submit to CRA</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {slipKpis.map((k) => (
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
          <CardTitle>T4 details by employee</CardTitle>
          <span className="text-xs text-slate-500">All figures from 2025 calendar year</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Employee</th>
                <th className="text-right font-medium px-3 py-2.5">Box 14<br /><span className="font-normal normal-case">Income</span></th>
                <th className="text-right font-medium px-3 py-2.5">Box 16<br /><span className="font-normal normal-case">CPP</span></th>
                <th className="text-right font-medium px-3 py-2.5">Box 18<br /><span className="font-normal normal-case">EI</span></th>
                <th className="text-right font-medium px-3 py-2.5">Box 22<br /><span className="font-normal normal-case">Income tax</span></th>
                <th className="text-right font-medium px-3 py-2.5">Box 24<br /><span className="font-normal normal-case">EI insurable</span></th>
                <th className="text-right font-medium px-3 py-2.5">Box 26<br /><span className="font-normal normal-case">CPP insurable</span></th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {slipRows.map((r) => (
                <tr key={r.name} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{r.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtCAD(r.b14)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtCAD(r.b16)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtCAD(r.b18)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtCAD(r.b22)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtCAD(r.b24)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtCAD(r.b26)}</td>
                  <td className="px-3 py-3"><Badge tone={statusTone[r.status]}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="p-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 flex-1">
          <strong>Priya Singh — Box 24 mismatch:</strong> insurable earnings ($68,500) reflect EI maximum cap, but Box 14 ($76,752) is higher. Mathematically correct but worth flagging for review before submission.
        </div>
        <button className="text-xs text-amber-700 font-medium hover:underline">View calc</button>
      </div>

      <div className="p-3 rounded-lg bg-violet-50 ring-1 ring-violet-200 flex items-start gap-3">
        <Sparkles className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
        <div className="text-sm text-violet-900 flex-1">
          <strong>Tom Reilly — ROE reason code:</strong> AI suggests <code className="px-1 bg-white rounded font-mono text-xs">A — Shortage of work</code> based on termination context (last paid Mar 15, no rehire planned). Confirm before filing ROE Web.
        </div>
        <Button variant="ai" className="text-xs py-1 px-2">Confirm</Button>
      </div>
    </div>
  );
}
