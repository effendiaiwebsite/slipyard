"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { upcomingMeetings, meetingBrief } from "@/lib/fixtures";
import { fmtCAD } from "@/lib/utils";
import { NotebookPen, Sparkles, Calendar, Users, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";

const urgencyTone: Record<string, "danger" | "warn" | "info"> = {
  high: "danger", med: "warn", low: "info",
};

export default function MeetingPrepPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">AI · Meeting prep</div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-slate-500" /> Meeting prep brief
          </h1>
          <p className="text-sm text-slate-600 mt-1">Auto-generated 30 min before each call · pulls from client file, recent docs, AI sweep</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Meetings list */}
        <div className="col-span-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-slate-400 px-1">Upcoming</div>
          {upcomingMeetings.map((m, i) => {
            const isActive = m.client === meetingBrief.client;
            return (
              <Card key={i} className={`cursor-pointer hover:ring-2 hover:ring-violet-200 transition ${isActive ? "ring-2 ring-violet-300 bg-violet-50/40" : ""}`}>
                <CardBody className="!p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-slate-500 font-medium">{m.time}</div>
                    {m.prep === "ready" ? (
                      <Badge tone="success"><CheckCircle2 className="w-2.5 h-2.5" /> ready</Badge>
                    ) : (
                      <Badge tone="warn">drafting</Badge>
                    )}
                  </div>
                  <div className="text-sm font-semibold">{m.client}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{m.type} · {m.duration}</div>
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Brief */}
        <div className="col-span-8 space-y-4">
          <Card>
            <CardHeader className="!py-4 bg-gradient-to-r from-violet-50 to-white">
              <div>
                <div className="text-xs text-violet-600 font-semibold uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI-generated brief
                </div>
                <h2 className="text-lg font-bold mt-1">{meetingBrief.client}</h2>
                <div className="text-sm text-slate-600 mt-0.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> {meetingBrief.time}
                </div>
              </div>
              <Button variant="primary">Open in meeting view</Button>
            </CardHeader>
            <CardBody className="space-y-4">
              <Section icon={<Users className="w-3.5 h-3.5" />} title="Attendees">
                <div className="text-sm text-slate-700">{meetingBrief.attendees.join(" · ")}</div>
              </Section>

              <Section title="Context">
                <div className="text-sm text-slate-700 leading-relaxed">{meetingBrief.context}</div>
              </Section>

              <Section title="Open items — bring up in this order">
                <ul className="space-y-2">
                  {meetingBrief.openItems.map((it, i) => (
                    <li key={i} className="flex items-start gap-2.5 p-2.5 rounded-md ring-1 ring-slate-200">
                      <span className="mt-0.5"><Badge tone={urgencyTone[it.urgency]}>{it.urgency}</Badge></span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{it.label}</div>
                        <div className="text-xs text-slate-600 mt-0.5">{it.note}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Recent activity">
                <ul className="text-sm text-slate-700 space-y-1">
                  {meetingBrief.recentActivity.map((a, i) => (
                    <li key={i} className="flex gap-2"><span className="text-slate-300">›</span>{a}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Suggested talking points">
                <ol className="text-sm text-slate-700 space-y-1.5 list-decimal pl-5">
                  {meetingBrief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
                </ol>
              </Section>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-400" /> Financial snapshot</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-4 gap-4">
                {meetingBrief.financials.map((f) => (
                  <div key={f.label}>
                    <div className="text-xs text-slate-500">{f.label}</div>
                    <div className="text-lg font-semibold tracking-tight mt-0.5">{f.value}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">{icon}{title}</div>
      {children}
    </div>
  );
}
