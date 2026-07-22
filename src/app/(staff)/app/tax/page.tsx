import { FileWarning, Inbox, ListChecks } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_META, ENGAGEMENT_TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";

export const metadata = { title: "Returns" };

/**
 * Returns page + missing-docs dashboard (M3): every engagement for a tax
 * year with its stage and checklist state, topped by the "who still owes us
 * paper" rollup.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const ctx = await requireStaff();
  const params = await searchParams;
  const assignedOnly = viewAssignedOnlyFilter(ctx);

  const [allEngagements, summaries, missingItems, intakeDocs] = await Promise.all([
    ctx.scope.listEngagementsWithMeta({ assignedToId: assignedOnly }),
    ctx.scope.listChecklistSummaries(),
    ctx.scope.listMissingChecklistItems(),
    ctx.scope.listIntakeDocuments(),
  ]);

  const years = [...new Set(allEngagements.map((e) => e.engagement.taxYear))].sort((a, b) => b - a);
  const year = params.year ? Number(params.year) : (years[0] ?? new Date().getFullYear() - 1);
  const engagements = allEngagements.filter((e) => e.engagement.taxYear === year);

  const summaryByEngagement = new Map(summaries.map((s) => [s.engagementId, s]));
  const missingByEngagement = new Map<string, string[]>();
  for (const item of missingItems) {
    if (!item.required) continue;
    const list = missingByEngagement.get(item.engagementId) ?? [];
    list.push(item.title);
    missingByEngagement.set(item.engagementId, list);
  }

  const visibleEngagementIds = new Set(allEngagements.map((e) => e.engagement.id));
  const waitingOnDocs = engagements.filter(
    (e) => (summaryByEngagement.get(e.engagement.id)?.requiredMissing ?? 0) > 0
  );
  const totalMissingRequired = [...missingByEngagement.entries()]
    .filter(([id]) => visibleEngagementIds.has(id))
    .reduce((n, [, titles]) => n + titles.length, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Returns</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tax year {year} · {engagements.length} return{engagements.length === 1 ? "" : "s"}
          </p>
        </div>
        {years.length > 1 && (
          <div className="flex items-center gap-1.5">
            {years.map((y) => (
              <Link
                key={y}
                href={`/app/tax?year=${y}`}
                className={
                  y === year
                    ? "px-2.5 py-1 rounded-md text-xs bg-slate-900 text-white"
                    : "px-2.5 py-1 rounded-md text-xs text-slate-600 hover:bg-slate-100 ring-1 ring-slate-200"
                }
              >
                {y}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<FileWarning className="w-4 h-4 text-amber-600" />}
          label="Returns waiting on documents"
          value={waitingOnDocs.length}
        />
        <StatCard
          icon={<ListChecks className="w-4 h-4 text-indigo-600" />}
          label="Required documents still missing"
          value={totalMissingRequired}
        />
        <Link href="/app/tax/intake" className="block">
          <StatCard
            icon={<Inbox className="w-4 h-4 text-slate-600" />}
            label="Documents in intake queue"
            value={intakeDocs.length}
          />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">All returns · {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {engagements.length === 0 ? (
            <p className="text-sm text-slate-400">
              No engagements for {year}. Create them from a client&apos;s page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Return</th>
                    <th className="py-2 pr-3 font-medium">Stage</th>
                    <th className="py-2 pr-3 font-medium">Checklist</th>
                    <th className="py-2 pr-3 font-medium">Still missing</th>
                    <th className="py-2 font-medium">Assigned to</th>
                  </tr>
                </thead>
                <tbody>
                  {engagements.map(({ engagement: e, clientName, assignedName, stage }) => {
                    const summary = summaryByEngagement.get(e.id);
                    const missing = missingByEngagement.get(e.id) ?? [];
                    return (
                      <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-2.5 pr-3">
                          <Link
                            href={`/app/clients/${e.clientId}`}
                            className="text-indigo-700 hover:underline underline-offset-2"
                          >
                            {clientName}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-slate-600">
                          {ENGAGEMENT_TYPE_LABELS[e.type]} {e.taxYear}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={CATEGORY_META[stage.category].badge}>{stage.label}</Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-slate-600">
                          {summary ? (
                            <span className={summary.requiredMissing > 0 ? "text-amber-700" : "text-emerald-700"}>
                              {summary.requiredTotal - summary.requiredMissing}/{summary.requiredTotal} required in
                            </span>
                          ) : (
                            <span className="text-slate-400">No checklist</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-slate-500 max-w-64">
                          {missing.length > 0 ? (
                            <span title={missing.join(", ")}>
                              {missing.slice(0, 2).join(", ")}
                              {missing.length > 2 ? ` +${missing.length - 2} more` : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 text-xs text-slate-600">{assignedName ?? "Unassigned"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
          <div className="text-xs text-slate-500 mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
