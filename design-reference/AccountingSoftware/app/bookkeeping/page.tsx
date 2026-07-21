"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bookClient, bookKpis, bookTxns, bookAiTips } from "@/lib/fixtures";
import { fmtCAD, fmtPct } from "@/lib/utils";
import { Banknote, RefreshCw, Sparkles, Filter, Wand2, AlertTriangle, CircleCheck } from "lucide-react";
import { useState } from "react";

const filters = ["All", "Auto-categorized", "Needs review", "Income", "Expenses"] as const;

const toneByStatus: Record<string, "success" | "warn"> = {
  auto: "success",
  review: "warn",
};

export default function BookkeepingPage() {
  const [active, setActive] = useState<typeof filters[number]>("All");

  const filtered = bookTxns.filter((t) => {
    if (active === "All") return true;
    if (active === "Auto-categorized") return t.status === "auto";
    if (active === "Needs review") return t.status === "review";
    if (active === "Income") return t.amount > 0;
    if (active === "Expenses") return t.amount < 0;
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Bookkeeping · Bank feed</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Banknote className="w-5 h-5 text-slate-500" /> {bookClient.name}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 text-sm text-slate-600">
            <span>{bookClient.account}</span>
            <span className="text-slate-300">·</span>
            <span>Balance <strong className="text-slate-900">{fmtCAD(bookClient.balance)}</strong></span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1 text-emerald-600"><CircleCheck className="w-3.5 h-3.5" /> Synced {bookClient.lastSync}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button><RefreshCw className="w-4 h-4" /> Sync</Button>
          <Button variant="ai"><Wand2 className="w-4 h-4" /> Auto-categorize all</Button>
          <Button variant="primary">Close period</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {bookKpis.map((k) => (
          <Card key={k.label}>
            <CardBody className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">{k.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className="text-xs text-slate-500">{k.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Transaction table */}
        <div className="col-span-12 lg:col-span-9">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Filter className="w-4 h-4 text-slate-400" /> Transactions</CardTitle>
              <div className="flex items-center gap-1.5">
                {filters.map((f) => (
                  <button
                    key={f}
                    onClick={() => setActive(f)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                      active === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left font-medium px-5 py-2.5">Date</th>
                    <th className="text-left font-medium px-5 py-2.5">Description</th>
                    <th className="text-right font-medium px-5 py-2.5">Amount</th>
                    <th className="text-left font-medium px-5 py-2.5">AI category</th>
                    <th className="text-left font-medium px-5 py-2.5">GST/HST</th>
                    <th className="text-left font-medium px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => (
                    <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 text-slate-600 font-mono text-xs">{t.date}</td>
                      <td className="px-5 py-3 font-medium">{t.desc}</td>
                      <td className={`px-5 py-3 text-right tabular-nums font-medium ${t.amount > 0 ? "text-emerald-700" : "text-slate-800"}`}>
                        {t.amount > 0 ? "+" : ""}{fmtCAD(t.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-violet-500" />
                          <span className="text-slate-700">{t.cat}</span>
                          <span className={`text-[10px] tabular-nums ${t.conf >= 0.9 ? "text-emerald-600" : t.conf >= 0.75 ? "text-amber-600" : "text-rose-600"}`}>
                            {fmtPct(t.conf)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">{t.gst}</td>
                      <td className="px-5 py-3">
                        <Badge tone={toneByStatus[t.status]}>{t.status === "auto" ? "auto" : "review"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* AI sidebar */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <Card className="ring-2 ring-violet-200/70">
            <CardHeader className="bg-violet-50/60">
              <CardTitle className="flex items-center gap-2 text-violet-800"><Sparkles className="w-4 h-4" /> AI insights</CardTitle>
              <Badge tone="ai">{bookAiTips.length}</Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              {bookAiTips.map((t, i) => (
                <div key={i} className="p-2.5 rounded-md ring-1 ring-slate-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold leading-snug">{t.title}</div>
                      <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">{t.body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Active rules</CardTitle></CardHeader>
            <CardBody className="text-sm space-y-2">
              <div className="text-xs text-slate-500">23 rules · 8 learned this month</div>
              <div className="space-y-1.5">
                {[
                  ["PETRO-CANADA →", "Vehicle — Fuel"],
                  ["HOMEDEPOT →", "COGS — Materials"],
                  ["ROGERS BUSINESS →", "Telecom"],
                  ["TIM HORTONS →", "Meals (50%)"],
                ].map(([l, r]) => (
                  <div key={l} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-mono">{l}</span>
                    <span className="text-slate-800 font-medium">{r}</span>
                  </div>
                ))}
              </div>
              <button className="w-full mt-2 px-2 py-1.5 rounded-md text-xs text-slate-600 ring-1 ring-dashed ring-slate-300 hover:bg-slate-50">+ New rule</button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Period close</CardTitle></CardHeader>
            <CardBody className="text-sm space-y-1.5">
              <Step label="All transactions categorized" done={false} note="9 left" />
              <Step label="Bank reconciled" done={true} />
              <Step label="GST/HST reviewed" done={true} />
              <Step label="Owner draws confirmed" done={false} />
              <Step label="Manager sign-off" done={false} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Step({ label, done, note }: { label: string; done: boolean; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-3.5 h-3.5 rounded-full grid place-items-center ${done ? "bg-emerald-500" : "bg-slate-200"}`}>
        {done && <span className="text-white text-[10px]">✓</span>}
      </span>
      <span className={done ? "text-slate-500 line-through" : "text-slate-700"}>{label}</span>
      {note && <span className="ml-auto text-amber-600">{note}</span>}
    </div>
  );
}
