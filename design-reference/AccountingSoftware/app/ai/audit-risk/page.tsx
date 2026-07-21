"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auditRiskDist, highRiskList } from "@/lib/fixtures";
import { ShieldAlert, Sparkles, Flame, FileSearch, TrendingUp, TrendingDown } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

function riskTone(s: number): "success" | "neutral" | "warn" | "danger" {
  if (s < 20) return "success"; if (s < 40) return "neutral"; if (s < 60) return "warn"; return "danger";
}

export default function AuditRiskPage() {
  const total = auditRiskDist.reduce((s, b) => s + b.count, 0);
  const above60 = auditRiskDist.filter((b) => b.band.startsWith("61") || b.band.startsWith("81")).reduce((s, b) => s + b.count, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">AI · Audit risk</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" /> Audit risk dashboard
          </h1>
          <p className="text-sm text-slate-600 mt-1">{total} returns scored · {above60} above firm threshold (60) · pre-defense files auto-built</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ai"><Sparkles className="w-4 h-4" /> Re-score all</Button>
          <Button variant="primary"><FileSearch className="w-4 h-4" /> Build defense pack</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Risk distribution across {total} returns</CardTitle>
            <span className="text-xs text-slate-500">CRA review-trigger model · trained on 4yr review history</span>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={auditRiskDist} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="band" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {auditRiskDist.map((b, i) => <Cell key={i} fill={b.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top firm-wide drivers</CardTitle></CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Driver label="High M&E ratio" pct={32} note="6 returns" />
            <Driver label="Vehicle business %" pct={26} note="9 returns claim &gt; 70%" />
            <Driver label="Home office (T2200)" pct={22} note="11 returns" />
            <Driver label="SR&ED claim size" pct={18} note="2 returns &gt; 30% of revenue" />
            <Driver label="Cash deposit ratio" pct={14} note="3 cash-heavy clients" />
            <Driver label="Foreign property (T1135)" pct={9} note="4 returns" />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Flame className="w-4 h-4 text-rose-500" /> High-risk returns ({highRiskList.filter((c) => c.score >= 40).length})</CardTitle>
          <Badge tone="warn">defense files ready</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Client</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">Score</th>
                <th className="text-left font-medium px-3 py-2.5">YoY change</th>
                <th className="text-left font-medium px-3 py-2.5">Top contributors</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {highRiskList.map((r) => {
                const trendUp = r.change.startsWith("+");
                const trendDown = r.change.startsWith("-");
                return (
                  <tr key={r.client} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium">{r.client}</td>
                    <td className="px-3 py-3"><Badge tone="info">{r.type}</Badge></td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-10 text-right tabular-nums font-semibold text-lg">{r.score}</span>
                        <Badge tone={riskTone(r.score)}>{r.score >= 60 ? "high" : r.score >= 40 ? "med" : "low"}</Badge>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${trendUp ? "text-rose-600" : trendDown ? "text-emerald-600" : "text-slate-500"}`}>
                        {trendUp && <TrendingUp className="w-3 h-3" />}
                        {trendDown && <TrendingDown className="w-3 h-3" />}
                        {r.change}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.drivers.map((d, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">{d}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button className="text-xs py-1 px-2"><FileSearch className="w-3 h-3" /> Defense file</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Driver({ label, pct, note }: { label: string; pct: number; note: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-slate-500">{note}</span>
      </div>
      <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
