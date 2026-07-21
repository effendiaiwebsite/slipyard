"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { emailDrafts } from "@/lib/fixtures";
import { Mail, Sparkles, Send, Edit3, Clock, Check } from "lucide-react";
import { useState } from "react";

const typeTone: Record<string, "info" | "ai" | "warn" | "neutral"> = {
  "Missing info request": "warn",
  "NOA explanation": "info",
  "Filing reminder": "warn",
  "CRA correspondence triage": "ai",
};

const statusTone: Record<string, "warn" | "neutral" | "info"> = {
  draft: "warn", scheduled: "info", "needs review": "warn",
};

export default function EmailsPage() {
  const [selectedId, setSelectedId] = useState(emailDrafts[0].id);
  const selected = emailDrafts.find((e) => e.id === selectedId)!;

  return (
    <div className="p-6 grid grid-cols-12 gap-5 h-[calc(100vh-3.5rem)]">
      {/* List */}
      <div className="col-span-4 flex flex-col min-h-0">
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-0.5">AI · Email drafts</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Mail className="w-5 h-5 text-slate-500" /> Email drafts
          </h1>
          <p className="text-sm text-slate-600 mt-1">{emailDrafts.length} drafts · all reviewed by humans before send</p>
        </div>
        <Card className="flex-1 overflow-hidden flex flex-col min-h-0">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-400">Inbox</CardTitle>
            <Badge tone="ai">AI-drafted</Badge>
          </CardHeader>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {emailDrafts.map((e) => {
              const isActive = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] hover:bg-slate-50 ${isActive ? "bg-violet-50" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    <span className="text-sm font-semibold flex-1 truncate">{e.client}</span>
                    <span className="text-[10px] text-slate-400">{e.time}</span>
                  </div>
                  <div className="text-xs text-slate-700 truncate font-medium">{e.subject}</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge tone={typeTone[e.type] ?? "neutral"}>{e.type}</Badge>
                    <Badge tone={statusTone[e.status]}>{e.status}</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Preview */}
      <div className="col-span-8 flex flex-col min-h-0">
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader className="!py-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{selected.subject}</div>
              <div className="text-xs text-slate-500 mt-0.5">To: {selected.client.toLowerCase().replace(/[^a-z]/g, "") + "@email.com"} · From: sarah@lakesidecpa.com</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="ai">{selected.type}</Badge>
              <Button><Edit3 className="w-4 h-4" /> Edit</Button>
              <Button variant="primary"><Send className="w-4 h-4" /> Approve & send</Button>
            </div>
          </CardHeader>

          {/* Generation context */}
          <div className="px-6 py-3 bg-violet-50/50 border-b border-violet-100 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
            <div className="text-xs text-violet-900 flex-1">
              <span className="font-semibold">Generated from:</span> {selected.client}'s open engagement, AFR mismatch report, and prior-year RRSP slip pattern. {selected.time}.
            </div>
            <button className="text-xs text-violet-700 font-medium hover:underline whitespace-nowrap">Why this email?</button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-8 py-6">
            <div className="text-sm leading-relaxed whitespace-pre-line text-slate-800 max-w-2xl">
              {selected.body}
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] px-6 py-3 bg-slate-50/40 flex items-center gap-3 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            <span>Will queue for send approval. Human review required.</span>
            <span className="ml-auto inline-flex items-center gap-1 text-emerald-600"><Check className="w-3.5 h-3.5" /> No client PII left in prompt</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
