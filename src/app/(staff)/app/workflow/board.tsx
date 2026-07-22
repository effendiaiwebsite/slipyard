"use client";

import { Clock, GripVertical, Lock } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { CATEGORY_META } from "@/lib/clients";
import type { StageCategory } from "@/db/schema";
import { transitionEngagement } from "../clients/actions";

export type BoardStage = {
  id: string;
  key: string;
  label: string;
  category: StageCategory;
};

export type BoardCard = {
  id: string;
  clientId: string;
  clientName: string;
  label: string; // "T1 2025"
  stageId: string;
  assignedName: string | null;
  since: string | null; // ISO
  canTransition: boolean;
};

/**
 * Kanban over the org's own stages (ADR-0015) with native HTML5 drag &
 * drop. A drop is an optimistic move + permission-checked
 * transitionEngagement server action; a denial reverts the card and
 * surfaces the server's message.
 */
export function Board({ stages, cards }: { stages: BoardStage[]; cards: BoardCard[] }) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    cards,
    (state, move: { id: string; stageId: string }) =>
      state.map((c) => (c.id === move.id ? { ...c, stageId: move.stageId } : c))
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleDrop(stageId: string) {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id) return;
    const card = optimistic.find((c) => c.id === id);
    if (!card || card.stageId === stageId) return;
    setError(null);
    startTransition(async () => {
      applyMove({ id, stageId });
      const res = await transitionEngagement(id, stageId);
      // revalidatePath refreshes the RSC data; on failure the refresh itself
      // snaps the card back — we just surface why.
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <div
        className="flex-1 grid gap-3 overflow-x-auto min-w-0"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(180px, 1fr))` }}
      >
        {stages.map((stage) => {
          const meta = CATEGORY_META[stage.category];
          const colCards = optimistic.filter((c) => c.stageId === stage.id);
          const isTarget = dropTarget === stage.id && dragId !== null;
          return (
            <div
              key={stage.id}
              data-status={stage.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(stage.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage.id);
              }}
              className={`flex flex-col rounded-lg border-t-2 bg-slate-50/60 min-w-[180px] ${
                meta.board.split(" ")[0]
              } ${isTarget ? "ring-2 ring-indigo-300" : ""}`}
            >
              <div
                className={`px-3 py-2 rounded-t-md flex items-center justify-between ${meta.board
                  .split(" ")
                  .slice(1)
                  .join(" ")}`}
              >
                <span className="text-xs font-semibold tracking-wide">{stage.label}</span>
                <span className="text-xs font-bold">{colCards.length}</span>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto scrollbar-thin flex-1">
                {colCards.map((c) => (
                  <Card
                    key={c.id}
                    data-engagement={c.id}
                    draggable={c.canTransition && !isPending}
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    className={`p-3 shadow-sm transition ${
                      c.canTransition
                        ? "cursor-grab hover:ring-2 hover:ring-indigo-300"
                        : "opacity-75"
                    } ${dragId === c.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/app/clients/${c.clientId}`}
                          className="text-sm font-semibold truncate block hover:underline underline-offset-2"
                        >
                          {c.clientName}
                        </Link>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">{c.label}</div>
                      </div>
                      {c.canTransition ? (
                        <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        {c.since && (
                          <>
                            <Clock className="w-3 h-3" />
                            {new Date(c.since).toLocaleDateString("en-CA")}
                          </>
                        )}
                      </span>
                      <span className="font-medium text-slate-700">
                        {c.assignedName ?? "Unassigned"}
                      </span>
                    </div>
                  </Card>
                ))}
                {colCards.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-4">No cards</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
