"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { optKpis, firmOptimizations } from "@/lib/fixtures";
import { fmtCAD, fmtPct } from "@/lib/utils";
import { Sparkles, Lightbulb, Filter, ChevronDown, CheckCircle2, X } from "lucide-react";
import { useState } from "react";

const statusTone: Record<string, "warn" | "success" | "danger"> = {
  review: "warn", accepted: "success", rejected: "danger",
};

const toneClasses: Record<string, string> = {
  warn: "text-amber-600", success: "text-emerald-600", ai: "text-violet-600", neutral: "text-slate-500",
};

const categories = ["All", "RRSP", "FHSA", "SR&ED", "Pension split", "Spousal", "GRIP / CDA", "T776", "T2200", "Quick method", "T3 allocation", "Salary/dividend"];

export default function OptimizePage() {
  const [cat, setCat] = useState("All");
  const filtered = firmOptimizations.filter((o) => cat === "All" || o.category === cat);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Tax · Optimization advisor</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-500" /> Optimization advisor
          </h1>
          <p className="text-sm text-slate-600 mt-1">Firm-wide AI sweep across every open return · {firmOptimizations.length} opportunities found</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Filter className="w-4 h-4" /> Filter <ChevronDown className="w-3 h-3" /></Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Re-run sweep</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {optKpis.map((k) => (
          <Card key={k.label}>
            <CardBody className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">{k.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className={`text-xs ${toneClasses[k.tone]}`}>{k.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${cat === c ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {c}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-left font-medium px-3 py-2.5">Category</th>
                <th className="text-left font-medium px-3 py-2.5">Opportunity</th>
                <th className="text-right font-medium px-3 py-2.5">Impact</th>
                <th className="text-right font-medium px-3 py-2.5">Confidence</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{o.client}</td>
                  <td className="px-3 py-3"><Badge tone="info">{o.category}</Badge></td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{o.title}</div>
                    {o.note && <div className="text-[11px] text-slate-500 mt-0.5">{o.note}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {o.impact > 0 ? <span className="text-emerald-700 font-semibold">+{fmtCAD(o.impact)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-xs tabular-nums ${o.conf >= 0.9 ? "text-emerald-600" : o.conf >= 0.8 ? "text-amber-600" : "text-rose-600"}`}>
                      {fmtPct(o.conf)}
                    </span>
                  </td>
                  <td className="px-3 py-3"><Badge tone={statusTone[o.status]}>{o.status}</Badge></td>
                  <td className="px-3 py-3 text-right">
                    {o.status === "review" && (
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-1 rounded hover:bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-4 h-4" /></button>
                        <button className="p-1 rounded hover:bg-rose-100 text-rose-700"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
