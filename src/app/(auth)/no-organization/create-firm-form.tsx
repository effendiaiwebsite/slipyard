"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirm } from "./actions";

const TIMEZONES = [
  ["America/St_Johns", "Newfoundland (St. John's)"],
  ["America/Halifax", "Atlantic (Halifax)"],
  ["America/Toronto", "Eastern (Toronto)"],
  ["America/Winnipeg", "Central (Winnipeg)"],
  ["America/Regina", "Central — no DST (Regina)"],
  ["America/Edmonton", "Mountain (Edmonton)"],
  ["America/Vancouver", "Pacific (Vancouver)"],
] as const;

export function CreateFirmForm() {
  const [state, formAction, pending] = useActionState(createFirm, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="name">Firm name</Label>
        <Input id="name" name="name" required minLength={2} placeholder="e.g. Lakeside CPA" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue="America/Toronto"
          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        >
          {TIMEZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          Used for document timestamps and signing stamps. You can change it later in Settings.
        </p>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create firm and start 14-day trial"}
      </Button>
    </form>
  );
}
