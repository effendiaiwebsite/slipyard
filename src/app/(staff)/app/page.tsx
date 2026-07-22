import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_META } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { ENGAGEMENT_STATUSES } from "@/db/schema";

/**
 * Dashboard — firm-wide variant for owner/admin, personal variant for
 * accountant/clerk. M2 wires engagement/client counts; documents (M3),
 * signatures (M6) and authorizations (M7) fill in with their milestones.
 */
export default async function DashboardPage() {
  const ctx = await requireStaff();
  const firmWide = ctx.role === "owner" || ctx.role === "admin";

  // Personal variant counts only what's assigned to the viewer.
  const mineOnly = firmWide ? undefined : ctx.user.id;
  const [byStatus, clients, members] = await Promise.all([
    ctx.scope.countEngagementsByStatus(mineOnly),
    ctx.scope.listClientsWithMeta(mineOnly ? { assignedToId: mineOnly } : undefined),
    firmWide ? ctx.scope.listMemberships() : Promise.resolve(null),
  ]);

  const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const open =
    total - (byStatus.get("filed") ?? 0) - (byStatus.get("noa_received") ?? 0);
  const activeClients = clients.filter((c) => c.client.status === "active").length;

  const stats = [
    {
      label: firmWide ? "Active clients" : "My assigned clients",
      value: activeClients,
      href: "/app/clients",
    },
    { label: firmWide ? "Open engagements" : "My open engagements", value: open, href: "/app/workflow" },
    {
      label: "Awaiting documents",
      value: byStatus.get("awaiting_docs") ?? 0,
      href: "/app/workflow",
    },
    {
      label: "Awaiting signature",
      value: byStatus.get("awaiting_signature") ?? 0,
      href: "/app/workflow",
    },
  ];

  const upcoming = [
    { label: "Documents outstanding", milestone: "M3" },
    { label: "Signatures pending", milestone: "M6" },
    { label: "Authorization coverage", milestone: "M7" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back, {ctx.user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {firmWide
            ? `${ctx.orgName} — firm dashboard.`
            : "Your personal dashboard — your assigned clients and work."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {firmWide ? "Engagements by stage" : "My engagements by stage"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <p className="text-sm text-slate-400">
              No engagements yet — add one from a{" "}
              <Link href="/app/clients" className="underline underline-offset-2">
                client page
              </Link>
              .
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {ENGAGEMENT_STATUSES.map((s) => (
                <Link
                  key={s}
                  href="/app/workflow"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
                >
                  <Badge variant={STATUS_META[s].badge}>{STATUS_META[s].label}</Badge>
                  <span className="font-semibold tabular-nums">{byStatus.get(s) ?? 0}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {upcoming.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-slate-300">—</div>
              <Badge className="mt-2">Arrives in {s.milestone}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {firmWide && members && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Team</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            {members.filter((m) => m.membership.status === "active").length} active member(s).
            Manage roles and invitations in{" "}
            <a href="/app/settings/employees" className="underline underline-offset-2">
              Settings → Employees
            </a>
            .
          </CardContent>
        </Card>
      )}
    </div>
  );
}
