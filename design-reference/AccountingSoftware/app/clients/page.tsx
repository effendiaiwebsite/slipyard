"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clients } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { Search, Filter, Sparkles, Plus, Download, Flame, ChevronDown } from "lucide-react";
import { useState } from "react";

const typeFilters = ["All", "T1", "T2", "T3"] as const;

const stageTone: Record<string, "neutral" | "info" | "warn" | "success" | "ai"> = {
  Received: "neutral", "In Prep": "info", "Manager Review": "ai",
  "Partner Review": "warn", "Client Approval": "warn", Filed: "success",
};

function riskTone(s: number): "success" | "neutral" | "warn" | "danger" {
  if (s < 20) return "success";
  if (s < 40) return "neutral";
  if (s < 60) return "warn";
  return "danger";
}

export default function ClientsPage() {
  const [filter, setFilter] = useState<typeof typeFilters[number]>("All");
  const [q, setQ] = useState("");
  const filtered = clients.filter((c) => {
    if (filter !== "All" && c.type !== filter) return false;
    if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Clients</div>
          <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-slate-600 mt-1">{clients.length} active · 3 onboarding · 1 archived</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Download className="w-4 h-4" /> Export</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> AI sweep all</Button>
          <Button variant="primary"><Plus className="w-4 h-4" /> New client</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ID, SIN..." className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none" />
            </div>
            <div className="flex items-center gap-1">
              {typeFilters.map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{f}</button>
              ))}
            </div>
            <button className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"><Filter className="w-3.5 h-3.5" /> More filters <ChevronDown className="w-3 h-3" /></button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">Year-end</th>
                <th className="text-left font-medium px-3 py-2.5">Stage</th>
                <th className="text-left font-medium px-3 py-2.5">Owner</th>
                <th className="text-left font-medium px-3 py-2.5">Last contact</th>
                <th className="text-right font-medium px-3 py-2.5">WIP</th>
                <th className="text-left font-medium px-3 py-2.5">AI</th>
                <th className="text-left font-medium px-3 py-2.5">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50 cursor-pointer">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-3 py-3"><Badge tone="info">{c.type}</Badge></td>
                  <td className="px-3 py-3 text-slate-600 font-mono text-xs">{c.ye}</td>
                  <td className="px-3 py-3"><Badge tone={stageTone[c.stage]}>{c.stage}</Badge></td>
                  <td className="px-3 py-3 text-slate-600">{c.owner}</td>
                  <td className="px-3 py-3 text-slate-500 text-xs">{c.lastContact}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.wip > 0 ? fmtCAD(c.wip) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3">
                    {c.aiFlags > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium ring-1 ring-violet-200">
                        <Sparkles className="w-3 h-3" /> {c.aiFlags}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {c.risk >= 60 && <Flame className="w-3 h-3 text-rose-500" />}
                      <Badge tone={riskTone(c.risk)}>{c.risk}</Badge>
                    </span>
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
