import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizeCoverage } from "@/lib/authorizations";
import { CATEGORY_META, ENGAGEMENT_TYPE_LABELS, TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { entryAmountCents, formatCents, formatMinutes } from "@/lib/timebilling";

export const metadata = { title: "Reports" };

/**
 * Practice reports (M7): a read-only rollup of the numbers Joey asks for at
 * a glance — pipeline, client mix, CRA authorization coverage, and billing.
 * Scoped like every other list: assigned-only accountants see their book.
 */
export default async function ReportsPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const scopeOpts = assignedOnly ? { assignedToId: assignedOnly } : undefined;

  const [stages, byStage, clients, authRows, timeEntries, invoices] = await Promise.all([
    ctx.scope.listStages(),
    ctx.scope.countEngagementsByStage(assignedOnly),
    ctx.scope.listClientsWithMeta(scopeOpts),
    ctx.scope.listAuthorizations(scopeOpts),
    ctx.scope.listTimeEntries({ ...(scopeOpts ?? {}), limit: 5000 }),
    ctx.scope.listInvoices(scopeOpts),
  ]);
  const engagements = await ctx.scope.listEngagementsForClients(
    clients.map((c) => c.client.id)
  );

  // Client mix.
  const activeClients = clients.filter((c) => c.client.status === "active");
  const byType = new Map<string, number>();
  for (const c of activeClients) {
    byType.set(c.client.type, (byType.get(c.client.type) ?? 0) + 1);
  }

  // Pipeline by stage + engagement totals by type/year.
  const engagementTotal = stages.reduce((sum, s) => sum + (byStage.get(s.id) ?? 0), 0);
  const byEngType = new Map<string, number>();
  for (const { engagement } of engagements) {
    const key = `${ENGAGEMENT_TYPE_LABELS[engagement.type]} ${engagement.taxYear}`;
    byEngType.set(key, (byEngType.get(key) ?? 0) + 1);
  }

  // Authorization coverage.
  const today = new Date();
  const authByClient = new Map<string, typeof authRows>();
  for (const row of authRows) {
    const list = authByClient.get(row.auth.clientId) ?? [];
    list.push(row);
    authByClient.set(row.auth.clientId, list);
  }
  let covered = 0;
  let authPending = 0;
  for (const c of activeClients) {
    const cov = summarizeCoverage(
      (authByClient.get(c.client.id) ?? []).map((r) => r.auth),
      today
    );
    if (cov.status === "active") covered++;
    else if (cov.status === "pending") authPending++;
  }

  // Billing.
  const unbilled = timeEntries.filter((r) => !r.entry.invoiceId);
  const wipCents = unbilled.reduce((sum, r) => sum + entryAmountCents(r.entry), 0);
  const wipMinutes = unbilled.reduce((sum, r) => sum + r.entry.minutes, 0);
  const outstandingCents = invoices
    .filter((r) => r.invoice.status === "sent")
    .reduce((sum, r) => sum + r.invoice.totalCents, 0);
  const paidCents = invoices
    .filter((r) => r.invoice.status === "paid")
    .reduce((sum, r) => sum + r.invoice.totalCents, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Practice rollup{assignedOnly ? " — your assigned clients" : ""}. Numbers reflect this
          moment; nothing here is exported or stored.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {engagementTotal === 0 ? (
              <p className="text-sm text-slate-400">No engagements.</p>
            ) : (
              <ul className="space-y-2">
                {stages.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <Badge variant={CATEGORY_META[s.category].badge}>{s.label}</Badge>
                    <span className="font-semibold tabular-nums">{byStage.get(s.id) ?? 0}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between text-sm border-t border-[var(--color-border)] pt-2">
                  <span className="text-slate-500">Total engagements</span>
                  <span className="font-semibold tabular-nums">{engagementTotal}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Clients &amp; returns</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Active clients</dt>
                <dd className="font-semibold tabular-nums">{activeClients.length}</dd>
              </div>
              {(["individual", "corporation", "trust"] as const).map((t) =>
                byType.get(t) ? (
                  <div key={t} className="flex justify-between">
                    <dt className="text-slate-500 pl-3">{TYPE_LABELS[t]}s</dt>
                    <dd className="tabular-nums">{byType.get(t)}</dd>
                  </div>
                ) : null
              )}
              {[...byEngType.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([label, count]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-slate-500">{label} returns</dt>
                    <dd className="tabular-nums">{count}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">CRA authorization coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Covered (active authorization)</dt>
                <dd className="font-semibold tabular-nums">
                  {covered} / {activeClients.length}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Pending with CRA</dt>
                <dd className="tabular-nums">{authPending}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">No usable authorization</dt>
                <dd className="tabular-nums">{activeClients.length - covered - authPending}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Billing</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Unbilled work</dt>
                <dd className="font-semibold tabular-nums">
                  {formatCents(wipCents)}
                  <span className="text-slate-400 font-normal"> · {formatMinutes(wipMinutes)}</span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Invoiced, awaiting payment</dt>
                <dd className="tabular-nums">{formatCents(outstandingCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Paid</dt>
                <dd className="tabular-nums">{formatCents(paidCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Invoices issued</dt>
                <dd className="tabular-nums">{invoices.filter((r) => r.invoice.status !== "draft").length}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
