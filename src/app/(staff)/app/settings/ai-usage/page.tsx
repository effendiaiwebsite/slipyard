import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiFeatureName } from "@/db/schema";

export const metadata = { title: "AI usage" };

const FEATURE_LABEL: Record<AiFeatureName, string> = {
  assistant: "Assistant",
  email_draft: "Email draft",
  meeting_prep: "Meeting prep",
  audit_risk: "Audit risk",
  optimize: "Optimization",
};

/**
 * AI usage log (M10, ADR-0036): every AiService run — who asked, which
 * feature, which read tools ran, model + token counts, and the full
 * prompt/response for spot review. Gated by audit.view (owner/admin), same
 * posture as the audit log this complements.
 */
export default async function AiUsagePage() {
  const ctx = await requireStaff();
  if (!can(ctx.actor, "audit.view")) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">AI usage</h1>
        <p className="text-sm text-slate-500 mt-1">You don&apos;t have access to this section.</p>
      </div>
    );
  }

  const rows = await ctx.scope.listAiInteractionsWithUsers(100);
  const totalIn = rows.reduce((n, r) => n + (r.interaction.inputTokens ?? 0), 0);
  const totalOut = rows.reduce((n, r) => n + (r.interaction.outputTokens ?? 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI usage</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every AI run is logged — the assistant only reads what the asking staff member could see,
          and it never writes records or sends anything.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Runs (last {rows.length})</CardDescription>
            <CardTitle className="text-2xl">{rows.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Input tokens</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totalIn.toLocaleString("en-CA")}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Output tokens</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totalOut.toLocaleString("en-CA")}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent runs</CardTitle>
          <CardDescription>Newest first · expand a row for the prompt and response.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">
              No AI activity yet. Runs appear here as staff use the AI pages.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map(({ interaction: r, userName }) => (
                <li key={r.id} className="py-3">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-3 flex-wrap text-sm">
                        <Badge variant="ai">{FEATURE_LABEL[r.feature]}</Badge>
                        <span className="font-medium">{userName ?? "Removed user"}</span>
                        <span className="text-slate-500">
                          {r.createdAt.toLocaleString("en-CA", { hour12: false })}
                        </span>
                        <span className="text-slate-400 text-xs">
                          {r.model}
                          {r.inputTokens != null &&
                            ` · ${r.inputTokens.toLocaleString("en-CA")} in / ${(r.outputTokens ?? 0).toLocaleString("en-CA")} out`}
                        </span>
                        {r.toolsUsed.length > 0 && (
                          <span className="text-xs text-slate-500">
                            tools: {r.toolsUsed.map((t) => `${t.tool} (${t.resultCount})`).join(", ")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 truncate mt-1">{r.prompt}</p>
                    </summary>
                    <div className="mt-2 space-y-2 text-sm">
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500 mb-1">Prompt</p>
                        <p className="whitespace-pre-wrap break-words">{r.prompt}</p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500 mb-1">Response</p>
                        <p className="whitespace-pre-wrap break-words">{r.response}</p>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
