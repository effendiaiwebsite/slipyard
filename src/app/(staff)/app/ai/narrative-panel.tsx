"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generateNarrative } from "./actions";

/** "Write a summary" — the AI narrates the findings table (never adds to it). */
export function NarrativePanel({ feature }: { feature: "audit_risk" | "optimize" }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3" data-testid="narrative-panel">
      <Button
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await generateNarrative(feature);
            if (res.error) setError(res.error);
            else setText(res.text ?? "");
          });
        }}
        disabled={isPending}
      >
        {isPending ? "Writing…" : text ? "Rewrite summary" : "Write a summary"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {text !== null && !error && (
        <div
          className="text-sm whitespace-pre-wrap rounded-md bg-slate-50 ring-1 ring-slate-200 p-4"
          data-testid="narrative-text"
        >
          {text}
        </div>
      )}
    </div>
  );
}
