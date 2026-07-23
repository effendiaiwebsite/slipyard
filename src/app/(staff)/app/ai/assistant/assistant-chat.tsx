"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { askAssistantAction } from "../actions";

/**
 * Knowledge assistant chat. History lives in this component only — every
 * exchange is already durably logged server-side in ai_interaction.
 */

type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Who are we still waiting on documents from?",
  "How does the pipeline look right now?",
  "Which clients have no CRA authorization?",
];

export function AssistantChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isPending) return;
    setError(null);
    const history = turns;
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    if (inputRef.current) inputRef.current.value = "";
    startTransition(async () => {
      const res = await askAssistantAction(trimmed, history);
      if (res.error) {
        setError(res.error);
        setTurns(history); // roll the optimistic user turn back
      } else {
        setTurns((prev) => [...prev, { role: "assistant", content: res.text ?? "" }]);
      }
    });
  };

  return (
    <div className="space-y-4" data-testid="assistant-chat">
      <div className="space-y-3">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="text-xs px-3 py-1.5 rounded-full ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            data-testid={`chat-${t.role}`}
            className={
              t.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm whitespace-pre-wrap"
                : "mr-auto max-w-[85%] rounded-lg bg-slate-100 text-slate-800 px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {t.content}
          </div>
        ))}
        {isPending && <p className="text-sm text-slate-400">Thinking…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(inputRef.current?.value ?? "");
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          placeholder="Ask about clients, returns, documents, coverage, billing…"
          aria-label="Question for the assistant"
          className="flex-1 px-3 py-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(inputRef.current?.value ?? "");
            }
          }}
        />
        <Button type="submit" disabled={isPending}>
          Ask
        </Button>
      </form>
    </div>
  );
}
