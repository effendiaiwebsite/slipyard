"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrgProfile, updateOrgSettings } from "./actions";

const TIMEZONES = [
  ["America/St_Johns", "Newfoundland (St. John's)"],
  ["America/Halifax", "Atlantic (Halifax)"],
  ["America/Toronto", "Eastern (Toronto)"],
  ["America/Winnipeg", "Central (Winnipeg)"],
  ["America/Regina", "Central — no DST (Regina)"],
  ["America/Edmonton", "Mountain (Edmonton)"],
  ["America/Vancouver", "Pacific (Vancouver)"],
] as const;

export function OrgProfileForm({
  name,
  timezone,
  disabled,
}: {
  name: string;
  timezone: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateOrgProfile, null);
  return (
    <form action={action} className="space-y-3 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">Firm name</Label>
        <Input id="org-name" name="name" defaultValue={name} required disabled={disabled} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-tz">Timezone</Label>
        <select
          id="org-tz"
          name="timezone"
          defaultValue={timezone}
          disabled={disabled}
          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm"
        >
          {TIMEZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">Used for signing stamps and document timestamps.</p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        {state?.ok && <span className="text-sm text-emerald-600">Saved.</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function OrgSettingsForm({
  aiEnabled,
  scopeMode,
  disabled,
}: {
  aiEnabled: boolean;
  scopeMode: "all_read" | "assigned_only";
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateOrgSettings, null);
  return (
    <form action={action} className="space-y-4 max-w-md">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="ai_enabled"
          defaultChecked={aiEnabled}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="font-medium">Enable AI features</span>
          <span className="block text-slate-500">
            Assistants draft and summarize only — they never change client records or send
            messages, and no SIN or full date of birth is ever sent to a model. (AI pages arrive
            in M8.)
          </span>
        </span>
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="scope-mode">Accountant visibility</Label>
        <select
          id="scope-mode"
          name="accountant_scope_mode"
          defaultValue={scopeMode}
          disabled={disabled}
          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm"
        >
          <option value="assigned_only">See only assigned clients (default)</option>
          <option value="all_read">Read all firm clients, edit only assigned</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {state?.ok && <span className="text-sm text-emerald-600">Saved.</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
