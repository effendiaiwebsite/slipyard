"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generateMeetingBrief } from "../actions";

type Option = { id: string; name: string };

export function MeetingPrepTool({ clients }: { clients: Option[] }) {
  const [clientId, setClientId] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generateMeetingBrief(clientId);
      if (res.error) setError(res.error);
      else setBrief(res.text ?? "");
    });
  };

  return (
    <div className="space-y-4" data-testid="meeting-prep">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none"
          aria-label="Client"
        >
          <option value="" disabled>
            Select client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button onClick={generate} disabled={isPending || !clientId}>
          {isPending ? "Preparing…" : "Prepare brief"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {brief !== null && !error && (
        <div
          className="text-sm whitespace-pre-wrap rounded-md bg-slate-50 ring-1 ring-slate-200 p-4"
          data-testid="meeting-brief"
        >
          {brief}
        </div>
      )}
    </div>
  );
}
