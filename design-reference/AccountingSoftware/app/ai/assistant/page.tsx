"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { chatThread } from "@/lib/fixtures";
import { Sparkles, Send, BookOpen, Plus, Pin } from "lucide-react";

export default function AssistantPage() {
  return (
    <div className="p-6 grid grid-cols-12 gap-5 h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="col-span-3 space-y-4 overflow-y-auto scrollbar-thin">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">AI · Knowledge assistant</div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-600" /> Assistant
          </h1>
        </div>

        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-slate-900 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /> New thread
        </button>

        <Card>
          <CardHeader><CardTitle className="text-xs uppercase tracking-wide text-slate-400">Recent threads</CardTitle></CardHeader>
          <CardBody className="space-y-1.5 text-sm !py-3">
            <ThreadLink active title="Meals deductibility — referral source" time="2 min ago" />
            <ThreadLink title="T2 schedule 50 — non-resident shareholders" time="yesterday" />
            <ThreadLink title="Principal residence designation — partial use" time="3 days ago" />
            <ThreadLink title="Section 85 rollover — what triggers a 22(1)?" time="last week" />
            <ThreadLink title="GST quick method break-even" time="last week" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-xs uppercase tracking-wide text-slate-400">Knowledge sources</CardTitle></CardHeader>
          <CardBody className="text-xs space-y-1.5">
            <KbLine label="CRA Income Tax Folios" count="487 docs" />
            <KbLine label="ITA + ITAR" count="1 (current)" />
            <KbLine label="IT bulletins (archived)" count="412 docs" />
            <KbLine label="Tax Court of Canada" count="12,840 cases" />
            <KbLine label="Firm internal memos" count="68 docs" />
          </CardBody>
        </Card>
      </aside>

      {/* Chat */}
      <div className="col-span-9 flex flex-col min-h-0">
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Meals deductibility — referral source</CardTitle>
            <div className="flex items-center gap-2">
              <button className="p-1 rounded hover:bg-slate-100 text-slate-500"><Pin className="w-4 h-4" /></button>
              <Badge tone="ai">grounded</Badge>
            </div>
          </CardHeader>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-5">
            {chatThread.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0 ${m.role === "user" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
                  {m.role === "user" ? "SK" : <Sparkles className="w-4 h-4" />}
                </div>
                <div className={`flex-1 max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-semibold">{m.role === "user" ? "Sarah Kovac" : "AI Assistant"}</span>
                    <span>·</span>
                    <span>{m.time}</span>
                  </div>
                  <div className={`inline-block text-left p-4 rounded-lg leading-relaxed text-sm ${m.role === "user" ? "bg-slate-100" : "bg-white ring-1 ring-slate-200"}`}>
                    <div className="whitespace-pre-line">{renderBold(m.content)}</div>
                    {m.role === "assistant" && m.citations && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <BookOpen className="w-3 h-3" /> Cited sources
                        </div>
                        <div className="space-y-1">
                          {m.citations.map((c, j) => (
                            <div key={j} className="text-xs flex items-center gap-2">
                              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">{c.source}</code>
                              <span className="text-slate-600">{c.note}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--color-border)] p-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <textarea
                  rows={2}
                  placeholder="Ask about ITA sections, CRA positions, court cases, or paste a fact pattern..."
                  className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 outline-none focus:ring-violet-400 focus:bg-white resize-none"
                />
                <div className="text-[11px] text-slate-400 mt-1">Every answer is grounded in cited sources. Don't paste client PII.</div>
              </div>
              <button className="px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 flex items-center gap-1.5">
                <Send className="w-4 h-4" /> Ask
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ThreadLink({ title, time, active }: { title: string; time: string; active?: boolean }) {
  return (
    <button className={`w-full text-left px-2 py-1.5 rounded-md ${active ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-slate-50"}`}>
      <div className={`text-xs font-medium ${active ? "text-violet-900" : "text-slate-800"} truncate`}>{title}</div>
      <div className={`text-[10px] mt-0.5 ${active ? "text-violet-600" : "text-slate-500"}`}>{time}</div>
    </button>
  );
}

function KbLine({ label, count }: { label: string; count: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-400 tabular-nums">{count}</span>
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="px-1 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-xs">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}
