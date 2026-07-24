"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteEmptyHousehold, mergeHouseholds, renameHousehold } from "./actions";

export type HouseholdRow = {
  id: string;
  name: string;
  members: Array<{ id: string; displayName: string; status: "active" | "archived" }>;
};

export function HouseholdsManager({
  households,
  canManage,
}: {
  households: HouseholdRow[];
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  const mergingFrom = households.find((h) => h.id === mergeSource);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {mergingFrom && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-4 text-sm flex items-center justify-between flex-wrap gap-2">
            <span>
              Merging <strong>{mergingFrom.name}</strong> — pick the household to move its{" "}
              {mergingFrom.members.length} member{mergingFrom.members.length === 1 ? "" : "s"} into.
            </span>
            <Button variant="ghost" size="sm" onClick={() => setMergeSource(null)}>
              Cancel merge
            </Button>
          </CardContent>
        </Card>
      )}
      {households.length === 0 && (
        <Card>
          <CardContent className="pt-4 text-sm text-slate-500">
            No households yet — create one from a client&apos;s edit form and it will appear here.
          </CardContent>
        </Card>
      )}
      {households.map((h) => (
        <Card key={h.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              {editing === h.id ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => renameHousehold(h.id, editName));
                    setEditing(null);
                  }}
                >
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 w-64"
                    autoFocus
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <CardTitle className="text-sm font-medium">{h.name}</CardTitle>
              )}
              {canManage && editing !== h.id && (
                <div className="flex items-center gap-1">
                  {mergeSource && mergeSource !== h.id ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        run(() => mergeHouseholds(mergeSource, h.id));
                        setMergeSource(null);
                      }}
                    >
                      Merge into this
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(h.id);
                          setEditName(h.name);
                        }}
                      >
                        Rename
                      </Button>
                      {h.members.length > 0 && households.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMergeSource(h.id)}
                          disabled={mergeSource === h.id}
                        >
                          Merge…
                        </Button>
                      )}
                      {h.members.length === 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(() => deleteEmptyHousehold(h.id))}
                        >
                          Delete
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {h.members.length === 0 ? (
              <p className="text-sm text-slate-500">No members.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {h.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Link
                      href={`/app/clients/${m.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {m.displayName}
                    </Link>
                    {m.status === "archived" && <Badge variant="default">archived</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
