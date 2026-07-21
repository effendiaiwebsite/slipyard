"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { employees, payrollKpis, bookClient } from "@/lib/fixtures";
import { UserCog, Plus, Sparkles, AlertCircle } from "lucide-react";

const td1Tone: Record<string, "success" | "danger"> = {
  "TD1 ✓": "success", "missing": "danger",
};

const statusTone: Record<string, "success" | "warn" | "neutral"> = {
  active: "success", "ROE pending": "warn",
};

const toneClasses: Record<string, string> = {
  warn: "text-amber-600", danger: "text-rose-600", success: "text-emerald-600", neutral: "text-slate-500", ai: "text-violet-600",
};

export default function PayrollPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Payroll · Employees</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <UserCog className="w-5 h-5 text-slate-500" /> {bookClient.name}
          </h1>
          <p className="text-sm text-slate-600 mt-1">5 active employees · Bi-weekly · Next pay run: Apr 30</p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Plus className="w-4 h-4" /> Add employee</Button>
          <Button variant="primary">Run payroll</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {payrollKpis.map((k) => (
          <Card key={k.label}>
            <CardBody className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">{k.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className={`text-xs ${toneClasses[k.tone]}`}>{k.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="p-3 rounded-lg bg-violet-50 ring-1 ring-violet-200 flex items-center gap-3">
        <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
        <div className="text-sm text-violet-900 flex-1">
          <strong>AI flagged:</strong> Priya Singh's TD1 was last updated in 2023 — federal basic personal amount has changed twice since. Send refreshed TD1 form?
        </div>
        <Button variant="ai" className="text-xs py-1 px-2">Send TD1 to Priya</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Employees</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-medium px-5 py-2.5">Name</th>
                <th className="text-left font-medium px-3 py-2.5">Role</th>
                <th className="text-left font-medium px-3 py-2.5">Pay rate</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">TD1</th>
                <th className="text-right font-medium px-3 py-2.5">Vacation accrued</th>
                <th className="text-left font-medium px-3 py-2.5">Last paid</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{e.name}</td>
                  <td className="px-3 py-3 text-slate-600">{e.role}</td>
                  <td className="px-3 py-3 text-slate-700">{e.rate}</td>
                  <td className="px-3 py-3 text-slate-600">{e.type}</td>
                  <td className="px-3 py-3">
                    <Badge tone={td1Tone[e.td1] ?? "neutral"}>
                      {e.td1 === "missing" && <AlertCircle className="w-3 h-3" />}
                      {e.td1}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{e.vacAccrued.toFixed(1)} hrs</td>
                  <td className="px-3 py-3 text-slate-500 text-xs font-mono">{e.lastPaid}</td>
                  <td className="px-3 py-3"><Badge tone={statusTone[e.status]}>{e.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
