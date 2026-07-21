"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clients, workloadByStage, type Stage } from "@/lib/fixtures";
import { Filter, Plus, Sparkles, AlertTriangle, Clock, GripVertical } from "lucide-react";

const stageColors: Record<Stage, string> = {
  Received: "border-slate-300",
  "In Prep": "border-indigo-400",
  "Manager Review": "border-sky-400",
  "Partner Review": "border-violet-500",
  "Client Approval": "border-amber-500",
  Filed: "border-emerald-500",
};
const stageHeaderBg: Record<Stage, string> = {
  Received: "bg-slate-50 text-slate-700",
  "In Prep": "bg-indigo-50 text-indigo-800",
  "Manager Review": "bg-sky-50 text-sky-800",
  "Partner Review": "bg-violet-50 text-violet-800",
  "Client Approval": "bg-amber-50 text-amber-800",
  Filed: "bg-emerald-50 text-emerald-800",
};

const blockedClients = new Set(["Patel Family Trust", "Lakeshore Cafe Ltd.", "Boreal Tech Inc."]);

export default function WorkflowPage() {
  const stages = workloadByStage.map((s) => s.stage);

  return (
    <div className="p-6 h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Workflow</div>
          <h1 className="text-xl font-semibold tracking-tight">Workflow board</h1>
          <p className="text-sm text-slate-600 mt-1">47 active engagements · 3 blocked · drag cards to advance stage</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Filter className="w-4 h-4" /> Filter</Button>
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Auto-unblock</Button>
          <Button variant="primary"><Plus className="w-4 h-4" /> New engagement</Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-6 gap-3 overflow-x-auto min-w-0">
        {stages.map((stage) => {
          const stageClients = clients.filter((c) => c.stage === stage);
          const totalCount = workloadByStage.find((w) => w.stage === stage)?.count ?? 0;
          return (
            <div key={stage} className={`flex flex-col rounded-lg border-t-2 ${stageColors[stage]} bg-slate-50/60 min-w-[200px]`}>
              <div className={`px-3 py-2 ${stageHeaderBg[stage]} rounded-t-md flex items-center justify-between`}>
                <span className="text-xs font-semibold tracking-wide">{stage}</span>
                <span className="text-xs font-bold">{totalCount}</span>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto scrollbar-thin">
                {stageClients.map((c) => (
                  <Card key={c.id} className="p-3 cursor-grab hover:ring-2 hover:ring-violet-300 transition shadow-sm">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{c.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{c.type} · YE {c.ye.slice(5)}</div>
                      </div>
                      <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <Badge tone="info">{c.type}</Badge>
                      {c.aiFlags > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                          <Sparkles className="w-2.5 h-2.5" /> {c.aiFlags}
                        </span>
                      )}
                      {c.risk >= 60 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                          risk {c.risk}
                        </span>
                      )}
                    </div>
                    {blockedClients.has(c.name) && (
                      <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-1.5 py-1 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Stuck 5+ days</span>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {c.lastContact}</span>
                      <span className="font-medium text-slate-700">{c.owner}</span>
                    </div>
                  </Card>
                ))}
                {stageClients.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-4">No cards</div>
                )}
                <button className="w-full px-2 py-1.5 rounded-md text-xs text-slate-500 ring-1 ring-dashed ring-slate-300 hover:bg-white">+ Card</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
