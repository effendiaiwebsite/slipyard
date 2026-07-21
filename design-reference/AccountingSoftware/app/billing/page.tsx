"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { billingKpis, timeToday, wipAging } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { Play, Clock, Sparkles, FileText, AlertTriangle } from "lucide-react";

export default function BillingPage() {
  const totalHours = timeToday.reduce((s, t) => s + t.hours, 0);
  const billable = timeToday.filter((t) => t.billable).reduce((s, t) => s + t.hours, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Time & billing</div>
          <h1 className="text-xl font-semibold tracking-tight">Time & billing</h1>
          <p className="text-sm text-slate-600 mt-1">Sarah Kovac · {billable.toFixed(2)} billable / {totalHours.toFixed(2)} total today</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ai"><Sparkles className="w-4 h-4" /> AI fee suggestion</Button>
          <Button variant="primary"><Play className="w-4 h-4" /> Start timer</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {billingKpis.map((k) => (
          <Card key={k.label}>
            <CardBody className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">{k.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className={`text-xs ${k.tone === "warn" ? "text-amber-600" : k.tone === "success" ? "text-emerald-600" : "text-slate-500"}`}>{k.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> Today's time</CardTitle>
            <span className="text-xs text-slate-500">Apr 30, 2026</span>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left font-medium px-5 py-2.5">Time</th>
                  <th className="text-left font-medium px-3 py-2.5">Client</th>
                  <th className="text-left font-medium px-3 py-2.5">Task</th>
                  <th className="text-right font-medium px-3 py-2.5">Hours</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {timeToday.map((t, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs text-slate-600 font-mono">{t.time}</td>
                    <td className="px-3 py-3 font-medium">{t.client}</td>
                    <td className="px-3 py-3 text-slate-700">{t.task}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{t.hours.toFixed(2)}</td>
                    <td className="px-3 py-3"><Badge tone={t.billable ? "success" : "neutral"}>{t.billable ? "billable" : "non-billable"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-violet-700"><Sparkles className="w-4 h-4" /> AI fee suggestion</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="text-sm font-semibold">New engagement: Boreal Tech Inc. — 2026 T2</div>
            <div className="p-3 rounded-md bg-violet-50 ring-1 ring-violet-200">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-violet-700 font-medium">Suggested fixed fee</div>
                  <div className="text-2xl font-semibold text-violet-900">$5,200 – $6,800</div>
                </div>
                <Badge tone="ai">conf 84%</Badge>
              </div>
            </div>
            <div className="text-xs text-slate-600 space-y-1.5">
              <div className="font-semibold">Based on:</div>
              <div>• 14 prior similar T2 engagements (CCPC, $2-5M rev)</div>
              <div>• SR&ED claim adds est. 6-9 hours</div>
              <div>• Series A capital change — +2 hours</div>
              <div>• Realization at this fee tier: 89%</div>
            </div>
            <Button variant="primary" className="w-full justify-center">Use $5,800 fixed fee</Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> WIP aging</CardTitle>
          <span className="text-xs text-amber-600 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> $8,200 over 90 days</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-right font-medium px-3 py-2.5">Current</th>
                <th className="text-right font-medium px-3 py-2.5">30-60</th>
                <th className="text-right font-medium px-3 py-2.5">60-90</th>
                <th className="text-right font-medium px-3 py-2.5">90+</th>
                <th className="text-right font-medium px-5 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {wipAging.map((r) => (
                <tr key={r.client} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{r.client}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{r.current ? fmtCAD(r.current) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{r.d30 ? fmtCAD(r.d30) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-amber-700">{r.d60 ? fmtCAD(r.d60) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-700 font-semibold">{r.d90 ? fmtCAD(r.d90) : "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmtCAD(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
