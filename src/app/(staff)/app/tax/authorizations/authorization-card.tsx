"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH_STATUS_BADGE } from "@/lib/authorizations";
import {
  createAuthorizationRecord,
  deleteAuthorizationRecord,
  updateAuthorizationRecord,
  type AuthActionResult,
} from "./actions";

/**
 * "CRA authorization" card on the client detail page: the client's records
 * with effective-status badges, plus add/edit/delete for staff who may manage
 * them. Display data (labels, effective status) is computed server-side.
 */

export type AuthorizationView = {
  id: string;
  level: "level1" | "level2" | "level3";
  levelLabel: string;
  /** What staff recorded. */
  status: "pending" | "active" | "expired" | "revoked";
  /** What it counts as now (active past expiry → expired). */
  effectiveStatus: "pending" | "active" | "expired" | "revoked";
  expiryDate: string | null;
  expiringSoon: boolean;
  notes: string | null;
};

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

function RecordForm({
  action,
  initial,
  submitLabel,
  onDone,
}: {
  action: (prev: AuthActionResult, fd: FormData) => Promise<AuthActionResult>;
  initial?: AuthorizationView;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: AuthActionResult, fd: FormData) => {
      const res = await action(prev, fd);
      if (res?.ok) onDone?.();
      return res;
    },
    null
  );
  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <select name="level" defaultValue={initial?.level ?? "level1"} className={selectCls}>
        <option value="level1">Level 1 — view</option>
        <option value="level2">Level 2 — view &amp; change</option>
        <option value="level3">Level 3 — delegate</option>
      </select>
      <select name="status" defaultValue={initial?.status ?? "pending"} className={selectCls}>
        <option value="pending">Pending CRA</option>
        <option value="active">Active</option>
        <option value="expired">Expired</option>
        <option value="revoked">Revoked</option>
      </select>
      <Input
        name="expiryDate"
        type="date"
        defaultValue={initial?.expiryDate ?? ""}
        title="Expiry (blank = does not expire)"
        className="h-8 w-36 text-xs"
      />
      <input
        name="notes"
        defaultValue={initial?.notes ?? ""}
        placeholder="Notes (optional)"
        className="flex-1 min-w-40 h-8 px-2 text-xs rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
      />
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state?.error && <span className="text-xs text-red-600 w-full">{state.error}</span>}
    </form>
  );
}

export function AuthorizationsCard({
  clientId,
  records,
  canManage,
}: {
  clientId: string;
  records: AuthorizationView[];
  canManage: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {records.length === 0 && (
        <p className="text-sm text-slate-400">
          No CRA authorization on file — the firm can&apos;t pull this client&apos;s CRA data yet.
        </p>
      )}
      <ul className="space-y-2">
        {records.map((r) => {
          const badge = AUTH_STATUS_BADGE[r.effectiveStatus];
          return (
            <li
              key={r.id}
              className="text-sm border-b border-[var(--color-border)] last:border-0 pb-2 last:pb-0 space-y-1.5"
            >
              {editingId === r.id ? (
                <RecordForm
                  action={(prev, fd) => updateAuthorizationRecord(r.id, prev, fd)}
                  initial={r}
                  submitLabel="Save"
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-700">{r.levelLabel}</span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {r.expiringSoon && <Badge variant="warn">Expiring soon</Badge>}
                  <span className="text-xs text-slate-400">
                    {r.expiryDate ? `expires ${r.expiryDate}` : "no expiry"}
                  </span>
                  {canManage && (
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => setEditingId(r.id)}
                        className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                      >
                        Edit
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() =>
                          startTransition(() => void deleteAuthorizationRecord(r.id))
                        }
                        className="text-xs text-slate-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              )}
              {r.notes && editingId !== r.id && (
                <p className="text-xs text-slate-500">{r.notes}</p>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <div className="pt-1">
          <div className="text-xs text-slate-500 mb-1.5">Add authorization</div>
          <RecordForm
            action={(prev, fd) => createAuthorizationRecord(clientId, prev, fd)}
            submitLabel="Add"
          />
        </div>
      )}
    </div>
  );
}
