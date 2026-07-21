"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  t1Client, t1Income, t1Deductions, t1Credits, t1Slips, t1Optimizations, t1AfrMismatches, t1AuditRisk,
} from "@/lib/fixtures";
import { fmtCAD, fmtPct } from "@/lib/utils";
import {
  CheckCircle2, AlertCircle, FileText, Sparkles, ChevronRight, ShieldAlert, GitCompare, FileSearch, Lightbulb,
} from "lucide-react";
import { useState } from "react";

const tabs = [
  { id: "ocr", label: "Slip OCR", icon: FileSearch, count: 6 },
  { id: "afr", label: "AFR mismatches", icon: GitCompare, count: 1 },
  { id: "opt", label: "Optimizations", icon: Lightbulb, count: 4 },
  { id: "risk", label: "Audit risk", icon: ShieldAlert, count: 0 },
] as const;

export default function T1Page() {
  const [tab, setTab] = useState<typeof tabs[number]["id"]>("opt");

  const totalIncome = t1Income.reduce((s, r) => s + r.amount, 0);
  const totalDeductions = t1Deductions.reduce((s, r) => s + r.amount, 0);
  const totalCredits = t1Credits.reduce((s, r) => s + r.amount, 0);
  const taxable = totalIncome - totalDeductions;
  const estTax = Math.round(taxable * 0.293);
  const credit = Math.round(totalCredits * 0.2);
  const netTax = estTax - credit;
  const totalSavings = t1Optimizations.reduce((s, o) => s + o.saving, 0);

  return (
    <div className="px-6 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
            Tax <ChevronRight className="w-3 h-3" /> T1 <ChevronRight className="w-3 h-3" /> {t1Client.taxYear}
          </div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            {t1Client.name} <span className="text-slate-400 font-normal">·</span>
            <span className="text-slate-500 font-normal text-base">SIN {t1Client.sin}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge tone="info">T1 — {t1Client.taxYear}</Badge>
            <Badge tone="neutral">Province: {t1Client.province}</Badge>
            <Badge tone="warn">{t1Client.status}</Badge>
            <span className="text-xs text-slate-500">Spouse: {t1Client.spouse}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button>Discard</Button>
          <Button>Save draft</Button>
          <Button variant="primary">Send to client review</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: client + docs */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <Card>
            <CardHeader><CardTitle>Engagement</CardTitle></CardHeader>
            <CardBody className="text-sm space-y-2">
              <Row k="Preparer" v={t1Client.preparer} />
              <Row k="Reviewer" v="A. Roy" />
              <Row k="Engagement fee" v="$650 fixed" />
              <Row k="Hours WTD" v="3.4 / 4.0 budget" />
              <Row k="Filing method" v="EFILE" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <span className="text-xs text-slate-500">6 of 7</span>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              {t1Slips.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  {s.status === "matched" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <span className="flex-1 truncate text-slate-700">{s.name}</span>
                  {s.ocrConf > 0 && <span className="text-[10px] text-slate-400">{fmtPct(s.ocrConf)}</span>}
                </div>
              ))}
              <button className="w-full mt-2 px-2 py-1.5 rounded-md text-xs text-slate-600 ring-1 ring-dashed ring-slate-300 hover:bg-slate-50">
                + Drop slip / receipt
              </button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardBody className="text-sm space-y-2">
              <Row k="Total income" v={fmtCAD(totalIncome)} />
              <Row k="Deductions" v={`-${fmtCAD(totalDeductions)}`} />
              <Row k="Taxable income" v={fmtCAD(taxable)} bold />
              <div className="border-t border-[var(--color-border)] my-1" />
              <Row k="Federal + ON tax" v={fmtCAD(estTax)} />
              <Row k="Non-ref. credits" v={`-${fmtCAD(credit)}`} />
              <Row k="Net tax payable" v={fmtCAD(netTax)} bold />
              <div className="mt-3 p-2 rounded-md bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-900">Est. refund</span>
                <span className="font-semibold text-emerald-700">{fmtCAD(2840)}</span>
              </div>
            </CardBody>
          </Card>
        </aside>

        {/* Middle: form */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          <Section title="Income" total={totalIncome} rows={t1Income} />
          <Section title="Deductions" total={totalDeductions} rows={t1Deductions} />
          <Section title="Non-refundable credits" total={totalCredits} rows={t1Credits} />
        </section>

        {/* Right: AI panel */}
        <aside className="col-span-12 lg:col-span-3">
          <Card className="sticky top-20 ring-2 ring-violet-200/70">
            <CardHeader className="bg-violet-50/60">
              <CardTitle className="flex items-center gap-2 text-violet-800">
                <Sparkles className="w-4 h-4" /> AI Assistant
              </CardTitle>
              <Badge tone="ai">live</Badge>
            </CardHeader>
            <div className="grid grid-cols-4 border-b border-[var(--color-border)] text-xs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-2 py-2.5 flex flex-col items-center gap-0.5 transition ${
                    tab === t.id ? "bg-violet-50 text-violet-800 border-b-2 border-violet-600 -mb-px" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  <span className="text-[10px] tracking-wide">{t.label.split(" ")[0]}</span>
                  {t.count > 0 && (
                    <span className="text-[9px] font-bold text-violet-700">{t.count}</span>
                  )}
                </button>
              ))}
            </div>
            <CardBody className="space-y-3 text-sm max-h-[600px] overflow-y-auto scrollbar-thin">
              {tab === "ocr" && (
                <>
                  <div className="text-xs text-slate-500">6 slips parsed by OCR · avg confidence 95%</div>
                  {t1Slips.map((s) => (
                    <div key={s.name} className="p-2.5 rounded-md ring-1 ring-slate-200">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-xs">{s.name}</div>
                        {s.status === "matched" ? <Badge tone="success">matched</Badge> : <Badge tone="warn">AFR only</Badge>}
                      </div>
                      {s.ocrConf > 0 && <div className="text-[11px] text-slate-500 mt-1">Confidence {fmtPct(s.ocrConf)} · auto-filed to T1 line</div>}
                    </div>
                  ))}
                </>
              )}

              {tab === "afr" && (
                <>
                  <div className="text-xs text-slate-500">Cross-checked with CRA AFR pulled 2026-04-29 14:02</div>
                  {t1AfrMismatches.map((m) => (
                    <div key={m.slip} className="p-2.5 rounded-md ring-1 ring-amber-200 bg-amber-50/40">
                      <div className="font-medium text-xs">{m.slip}</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">Line {m.line} · {fmtCAD(m.amount)}</div>
                      <div className="text-[11px] text-amber-800 mt-1.5">{m.status}</div>
                      {m.amount > 0 && (
                        <div className="flex gap-1.5 mt-2">
                          <Button className="text-[11px] py-1 px-2">Request from client</Button>
                          <Button className="text-[11px] py-1 px-2" variant="ghost">Pull from AFR</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {tab === "opt" && (
                <>
                  <div className="p-2.5 rounded-md bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-900">Total potential savings</span>
                    <span className="font-semibold text-emerald-700">{fmtCAD(totalSavings)}</span>
                  </div>
                  {t1Optimizations.map((o) => (
                    <div key={o.id} className="p-2.5 rounded-md ring-1 ring-slate-200 hover:ring-violet-300 transition">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold leading-snug flex-1">{o.title}</div>
                        <Badge tone="success">+{fmtCAD(o.saving)}</Badge>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">{o.detail}</div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                        <span>Source: {o.source}</span>
                        <span>conf {fmtPct(o.confidence)}</span>
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <Button variant="ai" className="text-[11px] py-1 px-2">Apply</Button>
                        <Button className="text-[11px] py-1 px-2" variant="ghost">Why?</Button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {tab === "risk" && (
                <>
                  <div className="p-3 rounded-md bg-emerald-50 ring-1 ring-emerald-200 text-center">
                    <div className="text-xs text-emerald-700 font-medium">Audit risk score</div>
                    <div className="text-3xl font-bold text-emerald-700 mt-0.5">{t1AuditRisk.score}<span className="text-base text-emerald-500">/100</span></div>
                    <div className="text-xs text-emerald-700 mt-0.5">{t1AuditRisk.band}</div>
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Top contributors:</div>
                  {t1AuditRisk.drivers.map((d) => (
                    <div key={d.label} className="p-2.5 rounded-md ring-1 ring-slate-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{d.label}</span>
                        <span className="text-slate-500">+{(d.weight * 100).toFixed(0)} pts</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1">{d.note}</div>
                    </div>
                  ))}
                </>
              )}
            </CardBody>
            <div className="border-t border-[var(--color-border)] p-3 bg-slate-50/60">
              <input placeholder="Ask about this return..." className="w-full px-2.5 py-1.5 text-xs rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-violet-400" />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 text-xs">{k}</span>
      <span className={bold ? "font-semibold" : "text-slate-800"}>{v}</span>
    </div>
  );
}

function Section({ title, total, rows }: { title: string; total: number; rows: { line: string; label: string; amount: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> {title}</CardTitle>
        <span className="text-sm font-semibold">{fmtCAD(total)}</span>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-5 py-2.5 w-20 text-xs text-slate-400 font-mono">{r.line}</td>
                <td className="px-2 py-2.5 text-slate-700">{r.label}</td>
                <td className="px-5 py-2.5 text-right tabular-nums w-32">{fmtCAD(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
