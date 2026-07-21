"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { intakeUploads, ocrCategories, missingFromPriorYear } from "@/lib/fixtures";
import { fmtCAD, fmtPct } from "@/lib/utils";
import {
  Upload, FileText, Sparkles, AlertCircle, CheckCircle2, Loader2, Mail, Inbox,
  ChevronRight, FileSearch, MessageSquarePlus, RotateCcw, FileQuestion, TrendingUp,
} from "lucide-react";
import { useState } from "react";

const statusTone: Record<string, "neutral" | "warn" | "success" | "info" | "ai"> = {
  ready: "success", review: "warn", processing: "ai",
};

const slipIconClass = "w-3.5 h-3.5";
const slipTypeIcons: Record<string, "doc" | "search" | "alert"> = {};

function confColor(c: number) {
  if (c >= 0.9) return "text-emerald-600";
  if (c >= 0.8) return "text-amber-600";
  return "text-rose-600";
}

export default function IntakePage() {
  const [selectedId, setSelectedId] = useState(intakeUploads[0].id);
  const selected = intakeUploads.find((u) => u.id === selectedId)!;

  const totalUploads = intakeUploads.length;
  const totalPages = intakeUploads.reduce((s, u) => s + u.pages, 0);
  const totalSlips = intakeUploads.reduce((s, u) => s + u.slips.length, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Tax · Document intake</div>
          <h1 className="text-xl font-semibold tracking-tight">Document intake</h1>
          <p className="text-sm text-slate-600 mt-1">
            {totalUploads} uploads · {totalPages} pages · {totalSlips} slips extracted by AI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button><Mail className="w-4 h-4" /> Email-in address</Button>
          <Button variant="primary"><Upload className="w-4 h-4" /> Upload</Button>
        </div>
      </div>

      {/* Compact drop zone */}
      <Card>
        <CardBody className="!p-3">
          <div className="border-2 border-dashed border-violet-300 bg-violet-50/40 rounded-lg p-4 flex items-center gap-4 hover:bg-violet-50 transition cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-violet-100 grid place-items-center shrink-0">
              <Upload className="w-4 h-4 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800">Drop PDFs, images, or ZIPs here</div>
              <div className="text-xs text-slate-500 mt-0.5">AI classifies each page in seconds · accepts up to 100MB · PDF, PNG, JPG, HEIC, ZIP</div>
            </div>
            <div className="text-xs text-slate-500 shrink-0">
              Email-in: <code className="px-1.5 py-0.5 rounded bg-white ring-1 ring-slate-200 font-mono">intake-c8x@lakesidecpa.com</code>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Master / detail */}
      <div className="grid grid-cols-12 gap-5">
        {/* Master list */}
        <div className="col-span-12 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Inbox className="w-4 h-4 text-slate-400" /> Recent uploads</CardTitle>
              <Badge tone="ai">{intakeUploads.length}</Badge>
            </CardHeader>
            <div className="divide-y divide-[var(--color-border)] max-h-[640px] overflow-y-auto scrollbar-thin">
              {intakeUploads.map((u) => {
                const isActive = u.id === selectedId;
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition flex gap-3 items-start ${isActive ? "bg-violet-50/60 ring-1 ring-violet-200" : ""}`}
                  >
                    <div className={`w-9 h-9 rounded-md grid place-items-center shrink-0 ${isActive ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold truncate">{u.client}</div>
                        <Badge tone={statusTone[u.status]}>
                          {u.status === "processing" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {u.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5 truncate font-mono">{u.file}</div>
                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                        <span>{u.pages} pages</span>
                        <span>·</span>
                        <span>{u.size}</span>
                        <span>·</span>
                        <span>{u.uploaded}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                        {u.status !== "processing" && (
                          <>
                            <span className="text-slate-600"><strong>{u.slips.length}</strong> slips found</span>
                            {u.lowConf > 0 && <span className="text-amber-600"><strong>{u.lowConf}</strong> low conf</span>}
                            {u.lowConf === 0 && u.classified === u.pages && <span className="text-emerald-600">all confident</span>}
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 shrink-0 ${isActive ? "text-violet-600" : "text-slate-300"}`} />
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Detail panel */}
        <div className="col-span-12 lg:col-span-7">
          <Card className="ring-2 ring-violet-200/70">
            <CardHeader className="bg-violet-50/40">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-violet-600" />
                  <span className="font-mono text-sm truncate">{selected.file}</span>
                  <Badge tone={statusTone[selected.status]}>{selected.status}</Badge>
                </div>
                <div className="text-xs text-slate-600 mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{selected.client}</span>
                  <span>·</span>
                  <span>{selected.pages} pages</span>
                  <span>·</span>
                  <span>{selected.size}</span>
                  <span>·</span>
                  <span>via {selected.via}</span>
                  <span>·</span>
                  <span className="font-mono">{selected.uploadedAt}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button><RotateCcw className="w-4 h-4" /> Re-classify</Button>
                <Button variant="primary">Approve all</Button>
              </div>
            </CardHeader>

            {/* Stats strip */}
            <div className="grid grid-cols-4 gap-0 border-b border-[var(--color-border)]">
              <Stat label="Pages" value={selected.pages.toString()} />
              <Stat label="Auto-classified" value={`${selected.classified} / ${selected.pages}`} tone={selected.classified === selected.pages ? "success" : "warn"} />
              <Stat label="Slips found" value={selected.slips.length.toString()} />
              <Stat label="Avg confidence" value={selected.avgConf > 0 ? fmtPct(selected.avgConf) : "—"} tone={selected.avgConf >= 0.9 ? "success" : selected.avgConf >= 0.8 ? "warn" : selected.avgConf > 0 ? "danger" : "neutral"} />
            </div>

            {/* Slips */}
            <CardBody className="space-y-3 max-h-[540px] overflow-y-auto scrollbar-thin">
              {selected.status === "processing" && (
                <div className="p-8 text-center">
                  <Loader2 className="w-8 h-8 text-violet-500 animate-spin mx-auto" />
                  <div className="text-sm font-medium mt-3">AI is reading {selected.pages} pages…</div>
                  <div className="text-xs text-slate-500 mt-1">Usually takes 10–30 seconds</div>
                </div>
              )}

              {selected.status !== "processing" && selected.slips.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                      <FileSearch className="w-3.5 h-3.5" /> Extracted slips
                    </div>
                    <span className="text-[11px] text-slate-500">click any slip to expand original page</span>
                  </div>

                  {selected.slips.map((slip, i) => {
                    const isUnclassified = slip.type === "Unclassified";
                    return (
                      <div
                        key={i}
                        className={`rounded-lg ring-1 p-3.5 transition hover:ring-violet-300 cursor-pointer ${
                          isUnclassified ? "ring-amber-200 bg-amber-50/40" : "ring-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-md grid place-items-center shrink-0 ${
                              isUnclassified ? "bg-amber-100 text-amber-600" : "bg-violet-100 text-violet-700"
                            }`}>
                              {isUnclassified ? <FileQuestion className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold flex items-center gap-2">
                                {slip.type}
                                {!isUnclassified && (
                                  <span className="text-xs text-slate-500 font-normal">— {slip.issuer}</span>
                                )}
                              </div>
                              {slip.note && (
                                <div className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>{slip.note}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`text-xs tabular-nums font-semibold ${confColor(slip.conf)}`}>
                              {fmtPct(slip.conf)}
                            </span>
                            {slip.conf >= 0.9 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-1 inline" />}
                          </div>
                        </div>

                        {slip.amounts.length > 0 && (
                          <div className="ml-10 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-2 pl-3 border-l-2 border-slate-100">
                            {slip.amounts.map(([label, amt], j) => (
                              <div key={j} className="flex items-center justify-between text-sm py-0.5">
                                <span className="text-slate-600 text-xs">{label}</span>
                                <span className="tabular-nums font-medium text-slate-900">
                                  {typeof amt === "number" && amt > 1000 ? fmtCAD(amt) :
                                   typeof amt === "number" ? amt.toLocaleString("en-CA") : amt}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </CardBody>

            {selected.status !== "processing" && (
              <div className="border-t border-[var(--color-border)] p-3 bg-slate-50/40 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-xs text-slate-600 flex-1">
                  AI applied {selected.slips.filter((s) => s.type !== "Unclassified").length} slips to {selected.client}'s 2025 return
                </span>
                <Button className="text-xs py-1 px-2"><MessageSquarePlus className="w-3 h-3" /> Ask client</Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Bottom row: stats + missing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-400" /> OCR by category</CardTitle>
            <span className="text-xs text-slate-500">2,355 docs YTD across 47 clients</span>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {ocrCategories.map((c) => (
                <div key={c.type} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 truncate font-medium text-slate-700">{c.type}</span>
                  <span className="text-slate-500 tabular-nums w-12 text-right">{c.count}</span>
                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${c.conf >= 0.9 ? "bg-emerald-400" : c.conf >= 0.8 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${c.conf * 100}%` }} />
                  </div>
                  <span className={`tabular-nums w-10 text-right text-xs ${confColor(c.conf)}`}>{fmtPct(c.conf)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> Missing vs prior year</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {missingFromPriorYear.map((m, i) => (
              <div key={i} className="text-sm">
                <div className="font-medium">{m.client}</div>
                <div className="text-xs text-slate-600">{m.slip}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{m.note}</div>
              </div>
            ))}
            <Button variant="ai" className="w-full justify-center mt-2">Send AI-drafted reminders</Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const toneClasses: Record<string, string> = {
  success: "text-emerald-700", warn: "text-amber-700", danger: "text-rose-700", neutral: "text-slate-700",
};

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-5 py-3 border-r border-[var(--color-border)] last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${toneClasses[tone]}`}>{value}</div>
    </div>
  );
}
