import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AUTH_LEVEL_LABELS,
  AUTH_STATUS_BADGE,
  EXPIRING_SOON_DAYS,
  needsAttention,
  summarizeCoverage,
  type ClientCoverage,
} from "@/lib/authorizations";
import { TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";

export const metadata = { title: "CRA authorizations" };

/**
 * Coverage dashboard (M7): every ACTIVE client rolled up to one verdict —
 * can the firm pull their CRA data right now? Records are managed on the
 * client detail page ("CRA authorization" card).
 */
export default async function AuthorizationsPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);

  const [clients, authRows] = await Promise.all([
    ctx.scope.listClientsWithMeta({
      status: "active",
      ...(assignedOnly ? { assignedToId: assignedOnly } : {}),
    }),
    ctx.scope.listAuthorizations(assignedOnly ? { assignedToId: assignedOnly } : undefined),
  ]);

  const today = new Date();
  const byClient = new Map<string, typeof authRows>();
  for (const row of authRows) {
    const list = byClient.get(row.auth.clientId) ?? [];
    list.push(row);
    byClient.set(row.auth.clientId, list);
  }

  const rows = clients.map((c) => {
    const coverage: ClientCoverage = summarizeCoverage(
      (byClient.get(c.client.id) ?? []).map((r) => r.auth),
      today
    );
    return { client: c.client, assignedName: c.assignedName, coverage };
  });
  // Needs-attention first, then by name (both groups stay alphabetical).
  rows.sort((a, b) => {
    const attention = Number(needsAttention(b.coverage)) - Number(needsAttention(a.coverage));
    return attention !== 0 ? attention : a.client.displayName.localeCompare(b.client.displayName);
  });

  const covered = rows.filter((r) => r.coverage.status === "active").length;
  const expiringSoon = rows.filter((r) => r.coverage.expiringSoon).length;
  const pending = rows.filter((r) => r.coverage.status === "pending").length;
  const uncovered = rows.length - covered;

  const stats = [
    { label: "Active clients covered", value: `${covered} / ${rows.length}` },
    { label: "Expiring soon", value: expiringSoon, hint: `within ${EXPIRING_SOON_DAYS} days` },
    { label: "Pending with CRA", value: pending },
    { label: "No CRA access", value: uncovered - pending },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">CRA authorizations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Which clients the firm can represent with the CRA
          {assignedOnly ? " — your assigned clients" : ""}. Add or update records on the
          client&apos;s page.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              {s.hint && <div className="text-xs text-slate-400 mt-1">{s.hint}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Coverage by client</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No active clients.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Assigned to</th>
                    <th className="py-2 pr-3 font-medium">Access level</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ client: c, assignedName, coverage }) => (
                    <tr
                      key={c.id}
                      data-testid="auth-coverage-row"
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          href={`/app/clients/${c.id}`}
                          className="text-indigo-700 hover:underline underline-offset-2"
                        >
                          {c.displayName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{TYPE_LABELS[c.type]}</td>
                      <td className="py-2 pr-3 text-slate-600">{assignedName ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">
                        {coverage.row ? AUTH_LEVEL_LABELS[coverage.row.level] : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          {coverage.status === "none" ? (
                            <Badge variant="danger">No authorization</Badge>
                          ) : (
                            <Badge variant={AUTH_STATUS_BADGE[coverage.status].variant}>
                              {AUTH_STATUS_BADGE[coverage.status].label}
                            </Badge>
                          )}
                          {coverage.expiringSoon && <Badge variant="warn">Expiring soon</Badge>}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {coverage.row?.expiryDate ?? (coverage.status === "active" ? "None" : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
