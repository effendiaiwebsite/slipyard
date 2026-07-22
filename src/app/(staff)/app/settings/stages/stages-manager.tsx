"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORY_META } from "@/lib/clients";
import { STAGE_CATEGORIES, type StageCategory } from "@/db/schema";
import { addStage, deleteStage, moveStage, renameStage, setStageCategory } from "./actions";

type StageRow = {
  id: string;
  label: string;
  category: StageCategory;
  count: number; // engagements currently in this stage
};

type ActionResult = { error?: string; ok?: boolean } | null;

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

export function StagesManager({ stages, disabled }: { stages: StageRow[]; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
    });

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {stages.map((s, i) => (
          <StageItem
            key={s.id}
            stage={s}
            first={i === 0}
            last={i === stages.length - 1}
            others={stages.filter((o) => o.id !== s.id)}
            disabled={disabled || isPending}
            run={run}
          />
        ))}
      </ul>

      {!disabled && <AddStageForm />}
    </div>
  );
}

function StageItem({
  stage,
  first,
  last,
  others,
  disabled,
  run,
}: {
  stage: StageRow;
  first: boolean;
  last: boolean;
  others: StageRow[];
  disabled: boolean;
  run: (fn: () => Promise<{ error?: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(stage.label);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reassignTo, setReassignTo] = useState(others[0]?.id ?? "");

  return (
    <li className="flex items-center gap-2 flex-wrap rounded-md ring-1 ring-slate-200 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          aria-label={`Move ${stage.label} up`}
          disabled={disabled || first}
          onClick={() => run(() => moveStage(stage.id, "up"))}
          className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          aria-label={`Move ${stage.label} down`}
          disabled={disabled || last}
          onClick={() => run(() => moveStage(stage.id, "down"))}
          className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-w-40">
        {editing ? (
          <span className="inline-flex items-center gap-1.5">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 w-48 text-sm"
              aria-label={`Rename ${stage.label}`}
            />
            <button
              aria-label="Save name"
              disabled={disabled}
              onClick={() => {
                setEditing(false);
                if (label.trim() && label !== stage.label)
                  run(() => renameStage(stage.id, label.trim()));
              }}
              className="text-emerald-600 hover:text-emerald-800"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              aria-label="Cancel rename"
              onClick={() => {
                setEditing(false);
                setLabel(stage.label);
              }}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Badge variant={CATEGORY_META[stage.category].badge}>{stage.label}</Badge>
            <span className="text-xs text-slate-400">
              {stage.count > 0 ? `${stage.count} engagement(s)` : "empty"}
            </span>
            {!disabled && (
              <button
                aria-label={`Rename ${stage.label}`}
                onClick={() => setEditing(true)}
                className="text-slate-400 hover:text-slate-700"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        means
        <select
          aria-label={`Meaning of ${stage.label}`}
          value={stage.category}
          disabled={disabled}
          onChange={(e) => run(() => setStageCategory(stage.id, e.target.value))}
          className={selectCls}
        >
          {STAGE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </label>

      {confirmingDelete ? (
        <span className="inline-flex items-center gap-1.5 text-xs">
          {stage.count > 0 && (
            <>
              move {stage.count} to
              <select
                aria-label="Move engagements to"
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className={selectCls}
              >
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setConfirmingDelete(false);
              run(() => deleteStage(stage.id, stage.count > 0 ? reassignTo : null));
            }}
          >
            Delete stage
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        !disabled && (
          <button
            aria-label={`Delete ${stage.label}`}
            onClick={() => setConfirmingDelete(true)}
            className="text-slate-400 hover:text-red-600"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )
      )}
    </li>
  );
}

function AddStageForm() {
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, fd: FormData) => addStage(prev, fd),
    null
  );
  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap border-t border-[var(--color-border)] pt-4">
      <Input name="label" required placeholder="New stage name" className="h-8 w-48 text-sm" />
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        means
        <select name="category" defaultValue="in_progress" className={selectCls}>
          {STAGE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add stage"}
      </Button>
      {state?.error && <span className="text-xs text-red-600 w-full">{state.error}</span>}
    </form>
  );
}
