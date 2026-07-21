"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { payRunMeta, payRunRows, payRunChecks, bookClient } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { PlayCircle, Sparkles, CheckCircle2, AlertCircle, Send } from "lucide-react";

const wizardSteps = ["Hours", "Review", "Approve", "Process", "Slips"] as const;

export default function PayRunPage() {
  const totalGross = payRunRows.reduce((s, r) => s + r.gross, 0);
  const totalDeductions = payRunRows.reduce((s, r) => s + r.fed + r.prov + r.cpp + r.ei + r.other, 0);
  const totalNet = payRunRows.reduce((s, r) => s + r.net, 0);
  const employerCpp = payRunRows.reduce((s, r) => s + r.cpp, 0);
  const employerEi = payRunRows.reduce((s, r) => s + r.ei * 1.4, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Payroll · Pay run</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-slate-500" /> {payRunMeta.frequency} pay run
          </h1>
          <p className="text-sm text-slate-600 mt-1">{bookClient.name} · period {payRunMeta.period} · pay date <strong>{payRunMeta.payDate}</strong></p>
        </div>
        <div className="flex items-center gap-2">
          <Button>Save & exit</Button>
          <Button variant="primary"><Send className="w-4 h-4" /> Approve & generate EFT</Button>
        </div>
      </div>

      {/* Wizard */}
      <Card>
        <CardBody className="!p-3">
          <div className="flex items-center gap-1.5">
            {wizardSteps.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 flex-1">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium flex-1 ${i === 1 ? "bg-slate-900 text-white" : i < 1 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-500"}`}>
                  <span className={`w-5 h-5 rounded-full grid place-items-center text-xs font-bold ${i === 1 ? "bg-white text-slate-900" : i < 1 ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {i < 1 ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                  </span>
                  {s}
                </div>
                {i < wizardSteps.length - 1 && <div className="w-2 h-px bg-slate-200" />}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Pay run table */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Step 2 — Review calculations</CardTitle>
              <Badge tone="ai"><Sparkles className="w-3 h-3" /> AI sanity check passed</Badge>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left font-medium px-5 py-2.5">Employee</th>
                    <th className="text-right font-medium px-2 py-2.5">Hrs</th>
                    <th className="text-right font-medium px-2 py-2.5">Gross</th>
                    <th className="text-right font-medium px-2 py-2.5">Fed tax</th>
                    <th className="text-right font-medium px-2 py-2.5">Prov tax</th>
                    <th className="text-right font-medium px-2 py-2.5">CPP</th>
                    <th className="text-right font-medium px-2 py-2.5">EI</th>
                    <th className="text-right font-medium px-3 py-2.5">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payRunRows.map((r) => (
                    <tr key={r.name} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium">{r.name}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{r.hours}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{fmtCAD(r.gross)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">{fmtCAD(r.fed)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">{fmtCAD(r.prov)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">{fmtCAD(r.cpp)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">{fmtCAD(r.ei)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtCAD(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50/60">
                  <tr className="font-semibold">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-2 py-3 text-right tabular-nums">{payRunRows.reduce((s, r) => s + r.hours, 0)}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{fmtCAD(totalGross)}</td>
                    <td colSpan={4} className="px-2 py-3 text-right tabular-nums text-slate-500">−{fmtCAD(totalDeductions)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtCAD(totalNet)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Employer obligations</CardTitle></CardHeader>
            <CardBody className="grid grid-cols-3 gap-4 text-sm">
              <Stat label="Employer CPP match" v={fmtCAD(employerCpp)} />
              <Stat label="Employer EI (1.4x)" v={fmtCAD(employerEi)} />
              <Stat label="WSIB est. (4.62%)" v={fmtCAD(totalGross * 0.0462)} />
              <Stat label="Total payroll cost" v={fmtCAD(totalGross + employerCpp + employerEi + totalGross * 0.0462)} highlight />
              <Stat label="PD7A (May 15)" v={fmtCAD(totalDeductions + employerCpp + employerEi)} />
              <Stat label="Direct deposit total" v={fmtCAD(totalNet)} />
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Pre-flight checks</CardTitle></CardHeader>
            <CardBody className="space-y-1.5">
              {payRunChecks.map((c) => (
                <div key={c.label} className="flex items-start gap-2 text-xs">
                  {c.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className={c.done ? "text-slate-500 line-through" : "text-slate-700 font-medium"}>{c.label}</div>
                    {c.note && <div className="text-[10px] text-amber-600 mt-0.5">{c.note}</div>}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card className="ring-2 ring-violet-200/70">
            <CardHeader className="bg-violet-50/60">
              <CardTitle className="flex items-center gap-2 text-violet-800"><Sparkles className="w-4 h-4" /> AI sanity check</CardTitle>
            </CardHeader>
            <CardBody className="text-xs space-y-2 text-slate-600">
              <div>✓ Hours within 8% of trailing 4-run average</div>
              <div>✓ No employee newly missing CPP/EI</div>
              <div>✓ Net pay totals reconcile to GL accrual</div>
              <div className="text-amber-600">⚠ Priya Singh's gross +12% vs prior — overtime claimed Apr 23-25, confirm with shop foreman</div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, highlight }: { label: string; v: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 tabular-nums ${highlight ? "text-base font-semibold" : "font-medium"}`}>{v}</div>
    </div>
  );
}
