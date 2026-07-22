"use client";

import { Pin, PinOff } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_META } from "@/lib/clients";
import { ENGAGEMENT_STATUSES, type EngagementStatus } from "@/db/schema";
import {
  addContactLogEntry,
  addNote,
  assignEngagement,
  createEngagement,
  setClientStatus,
  setNotePinned,
  transitionEngagement,
} from "../actions";

type Option = { id: string; name: string };
type ActionResult = { error?: string; ok?: boolean } | null;

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

export function AddNoteForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, fd: FormData) => addNote(clientId, prev, fd),
    null
  );
  return (
    <form action={formAction} className="space-y-2">
      <textarea
        name="body"
        required
        rows={3}
        placeholder="Add a note…"
        className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none resize-y"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" name="pinned" className="rounded" /> Pin to top
        </label>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function PinToggle({
  clientId,
  noteId,
  pinned,
}: {
  clientId: string;
  noteId: string;
  pinned: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      title={pinned ? "Unpin" : "Pin"}
      disabled={isPending}
      onClick={() => startTransition(() => void setNotePinned(clientId, noteId, !pinned))}
      className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
    >
      {pinned ? <Pin className="w-3.5 h-3.5 fill-current" /> : <PinOff className="w-3.5 h-3.5" />}
    </button>
  );
}

export function AddContactForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, fd: FormData) => addContactLogEntry(clientId, prev, fd),
    null
  );
  return (
    <form action={formAction} className="flex items-start gap-2 flex-wrap">
      <select name="channel" defaultValue="phone" className={selectCls}>
        <option value="phone">Phone</option>
        <option value="email">Email</option>
        <option value="sms">SMS</option>
        <option value="meeting">Meeting</option>
        <option value="mail">Mail</option>
        <option value="other">Other</option>
      </select>
      <Input name="occurredAt" type="date" className="h-8 w-36 text-xs" />
      <input
        name="summary"
        required
        placeholder="What happened?"
        className="flex-1 min-w-40 h-8 px-2 text-xs rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
      />
      <Button size="sm" type="submit" disabled={pending}>
        Log
      </Button>
      {state?.error && <span className="text-xs text-red-600 w-full">{state.error}</span>}
    </form>
  );
}

export function NewEngagementForm({
  clientId,
  members,
  defaultYear,
}: {
  clientId: string;
  members: Option[];
  defaultYear: number;
}) {
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, fd: FormData) => createEngagement(clientId, prev, fd),
    null
  );
  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <select name="type" defaultValue="t1" className={selectCls}>
        <option value="t1">T1</option>
        <option value="t2">T2</option>
        <option value="t3">T3</option>
        <option value="other">Other</option>
      </select>
      <Input
        name="taxYear"
        type="number"
        defaultValue={defaultYear}
        min={2000}
        max={2100}
        className="h-8 w-24 text-xs"
      />
      <select name="assignedToId" defaultValue="" className={selectCls}>
        <option value="">Client&apos;s accountant</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add engagement"}
      </Button>
      {state?.error && <span className="text-xs text-red-600 w-full">{state.error}</span>}
    </form>
  );
}

export function TransitionSelect({
  engagementId,
  status,
}: {
  engagementId: string;
  status: EngagementStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="Change stage"
        value={status}
        disabled={isPending}
        onChange={(e) =>
          startTransition(async () => {
            setError(null);
            const res = await transitionEngagement(engagementId, e.target.value);
            if (res.error) setError(res.error);
          })
        }
        className={selectCls}
      >
        {ENGAGEMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function AssignSelect({
  engagementId,
  members,
  current,
}: {
  engagementId: string;
  members: Option[];
  current: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="Assign engagement"
        value={current ?? ""}
        disabled={isPending}
        onChange={(e) =>
          startTransition(async () => {
            setError(null);
            const res = await assignEngagement(engagementId, e.target.value);
            if (res.error) setError(res.error);
          })
        }
        className={selectCls}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function ArchiveButton({
  clientId,
  status,
}: {
  clientId: string;
  status: "active" | "archived";
}) {
  const [isPending, startTransition] = useTransition();
  const next = status === "active" ? "archived" : "active";
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => void setClientStatus(clientId, next))}
    >
      {status === "active" ? "Archive" : "Restore"}
    </Button>
  );
}
