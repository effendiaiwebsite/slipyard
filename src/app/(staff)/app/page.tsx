import { requireStaff } from "@/lib/context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Dashboard — firm-wide variant for owner/admin, personal variant for
 * accountant/clerk (their assigned slice). M1 skeleton: real stats wire up
 * as each module lands (M2 engagements, M3 documents, M6 signatures, M7
 * authorizations).
 */
export default async function DashboardPage() {
  const ctx = await requireStaff();
  const firmWide = ctx.role === "owner" || ctx.role === "admin";

  const members = firmWide ? await ctx.scope.listMemberships() : null;

  const stats = firmWide
    ? [
        { label: "Engagements by status", milestone: "M2" },
        { label: "Documents outstanding", milestone: "M3" },
        { label: "Signatures pending", milestone: "M6" },
        { label: "Authorization coverage", milestone: "M7" },
      ]
    : [
        { label: "My assigned clients", milestone: "M2" },
        { label: "My open tasks", milestone: "M2" },
        { label: "Docs waiting on my clients", milestone: "M3" },
        { label: "My signatures pending", milestone: "M6" },
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
            : `Your personal dashboard — your clients and tasks appear here as modules land.`}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
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
