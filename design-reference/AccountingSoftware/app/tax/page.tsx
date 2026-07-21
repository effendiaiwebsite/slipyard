"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clients } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import Link from "next/link";
import { Sparkles, Download, ChevronRight, Flame } from "lucide-react";
import { useState } from "react";

const tabs = [
  { id: "T1", label: "T1 — Personal", count: 31 },
  { id: "T2", label: "T2 — Corporate", count: 14 },
  { id: "T3", label: "T3 — Trust", count: 4 },
  { id: "GST", label: "GST/HST", count: 18 },
  { id: "SLIPS", label: "Slips (T4/T5)", count: 87 },
] as const;

const stageTone: Record<string, "neutral" | "info" | "warn" | "success" | "ai"> = {
  Received: "neutral", "In Prep": "info", "Manager Review": "ai",
  "Partner Review": "warn", "Client Approval": "warn", Filed: "success",
};

function riskTone(s: number): "success" | "neutral" | "warn" | "danger" {
  if (s < 20) return "success"; if (s < 40) return "neutral"; if (s < 60) return "warn"; return "danger";
}

export default function TaxPage() {
  const [tab, setTab] = useState<typeof tabs[number]["id"]>("T1");
  const filtered = clients.filter((c) => {
    if (tab === "T1" || tab === "T2" || tab === "T3") return c.type === tab;
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Tax · Returns</div>
          <h1 className="text-xl font-semibold tracking-tight">Tax returns</h1>
          <p className="text-sm text-slate-600 mt-1">154 returns this season · 47 in flight · 12 due this week</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Download className="w-4 h-4" /> Export</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Pull AFR for all open T1s</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="!py-0 !px-0 !border-b-0">
          <div className="flex items-center px-2 -mb-px">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition ${
                  tab === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
                <span className={`text-xs px-1.5 rounded ${tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{t.count}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-left font-medium px-3 py-2.5">Year-end</th>
                <th className="text-left font-medium px-3 py-2.5">Stage</th>
                <th className="text-left font-medium px-3 py-2.5">Owner</th>
                <th className="text-left font-medium px-3 py-2.5">Risk</th>
                <th className="text-left font-medium px-3 py-2.5">AI</th>
                <th className="text-right font-medium px-3 py-2.5">Last contact</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-3 py-3 text-slate-600 font-mono text-xs">{c.ye}</td>
                  <td className="px-3 py-3"><Badge tone={stageTone[c.stage]}>{c.stage}</Badge></td>
                  <td className="px-3 py-3 text-slate-600">{c.owner}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {c.risk >= 60 && <Flame className="w-3 h-3 text-rose-500" />}
                      <Badge tone={riskTone(c.risk)}>{c.risk}</Badge>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {c.aiFlags > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium ring-1 ring-violet-200">
                        <Sparkles className="w-3 h-3" /> {c.aiFlags}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-500 text-xs">{c.lastContact}</td>
                  <td className="px-3 py-3 text-right">
                    {c.name === "Margaret Chen" ? (
                      <Link href="/tax/t1" className="text-xs text-violet-700 font-medium inline-flex items-center gap-1 hover:underline">
                        Open <ChevronRight className="w-3 h-3" />
                      </Link>
                    ) : (
                      <span className="text-slate-300 text-xs">Open</span>
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
