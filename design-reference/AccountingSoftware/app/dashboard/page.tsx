"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { kpis, deadlines, aiInsights, workloadByStage, firm } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { Sparkles, AlertTriangle, ArrowUpRight, CalendarClock, ChevronRight, Flame, Lightbulb, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import Link from "next/link";

const toneClasses: Record<string, string> = {
  neutral: "text-slate-700",
  success: "text-emerald-600",
  warn: "text-amber-600",
  ai: "text-violet-600",
};

const urgencyTone: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  overdue: "danger",
  today: "warn",
  soon: "info",
  later: "neutral",
};

const sevTone: Record<"high" | "med" | "low", "danger" | "warn" | "info"> = {
  high: "danger",
  med: "warn",
  low: "info",
};

const stageColors: Record<string, string> = {
  Received: "#94a3b8",
  "In Prep": "#6366f1",
  "Manager Review": "#0ea5e9",
  "Partner Review": "#7c3aed",
  "Client Approval": "#f59e0b",
  Filed: "#10b981",
};

export default function DashboardPage() {
  const greeting = new Date().getHours() < 12 ? "Good morning" : "Good afternoon";

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{firm.name} · Practice dashboard</div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {firm.user.name.split(" ")[0]}</h1>
          <p className="text-sm text-slate-600 mt-1">You have 12 returns due this week. AI flagged 3 high-impact opportunities worth a combined $7,790 in client savings.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-md bg-white ring-1 ring-slate-200 text-sm font-medium hover:bg-slate-50">Today (Apr 30)</button>
          <button className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm font-medium">+ New engagement</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => {
          const Icon = k.tone === "ai" ? Sparkles : k.tone === "warn" ? AlertTriangle : k.tone === "success" ? TrendingUp : Users;
          return (
            <Card key={k.label}>
              <CardBody className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">{k.label}</span>
                  <Icon className={`w-4 h-4 ${toneClasses[k.tone]}`} />
                </div>
                <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
                <div className={`text-xs ${toneClasses[k.tone]}`}>{k.delta}</div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Deadlines */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Upcoming deadlines</CardTitle>
            <Link href="#" className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">View all <ChevronRight className="w-3 h-3" /></Link>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase tracking-wide">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left font-medium px-5 py-2.5">Client</th>
                  <th className="text-left font-medium px-5 py-2.5">Form</th>
                  <th className="text-left font-medium px-5 py-2.5">Due</th>
                  <th className="text-left font-medium px-5 py-2.5">Stage</th>
                  <th className="text-left font-medium px-5 py-2.5">Owner</th>
                  <th className="text-left font-medium px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {deadlines.map((d) => (
                  <tr key={d.client + d.form} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium">{d.client}</td>
                    <td className="px-5 py-3 text-slate-600">{d.form}</td>
                    <td className="px-5 py-3 text-slate-600">{d.due}</td>
                    <td className="px-5 py-3 text-slate-600">{d.stage}</td>
                    <td className="px-5 py-3 text-slate-600">{d.owner}</td>
                    <td className="px-5 py-3"><Badge tone={urgencyTone[d.urgency]}>{d.urgency}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* AI Insights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-violet-700"><Sparkles className="w-4 h-4" /> AI insights</CardTitle>
            <Badge tone="ai">8 pending</Badge>
          </CardHeader>
          <CardBody className="space-y-3 max-h-[460px] overflow-y-auto scrollbar-thin">
            {aiInsights.map((ins) => (
              <div key={ins.id} className="p-3 rounded-lg ring-1 ring-slate-200 hover:ring-violet-300 transition cursor-pointer">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-xs text-slate-500 font-medium">{ins.client}</div>
                  <Badge tone={sevTone[ins.severity]}>{ins.severity}</Badge>
                </div>
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  {ins.severity === "high" ? <Flame className="w-3.5 h-3.5 text-rose-500" /> : <Lightbulb className="w-3.5 h-3.5 text-amber-500" />}
                  {ins.title}
                </div>
                <div className="text-xs text-slate-600 mt-1 leading-relaxed">{ins.body}</div>
                {ins.impact > 0 && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-700">+{fmtCAD(ins.impact)} impact</span>
                    <button className="text-xs text-violet-700 font-medium flex items-center gap-1 hover:underline">
                      Review <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workflow distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workflow distribution</CardTitle>
            <span className="text-xs text-slate-500">47 active engagements</span>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={workloadByStage} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {workloadByStage.map((s) => (
                    <Cell key={s.stage} fill={stageColors[s.stage]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Risk panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> Risk watch</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="p-3 rounded-lg bg-rose-50 ring-1 ring-rose-200">
              <div className="font-medium text-rose-900">2 returns past T2 deadline</div>
              <div className="text-xs text-rose-700 mt-1">Riverside Plumbing, Patel Family Trust — interest accruing</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 ring-1 ring-amber-200">
              <div className="font-medium text-amber-900">3 clients in Audit Risk &gt; 60</div>
              <div className="text-xs text-amber-700 mt-1">Pre-build defense files before filing</div>
            </div>
            <div className="p-3 rounded-lg bg-sky-50 ring-1 ring-sky-200">
              <div className="font-medium text-sky-900">14 GST/HST filings in 30 days</div>
              <div className="text-xs text-sky-700 mt-1">Run bulk auto-categorizer on bookkeeping</div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
