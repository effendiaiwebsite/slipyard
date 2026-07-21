import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireStaff } from "@/lib/context";

export default async function DashboardPage() {
  const ctx = await requireStaff();

  const stats = [
    { label: "Engagements by status", milestone: "M2" },
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
          {ctx.orgName} — firm dashboard. Live stats appear as each module lands.
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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Foundation status (M0)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-1.5">
          <p>✓ Multi-tenant database with row-level security</p>
          <p>✓ Staff sign-in with mandatory two-factor authentication</p>
          <p>✓ Role-based permission matrix with audit logging</p>
          <p>✓ Client portal shell (token-gated access arrives in M4)</p>
        </CardContent>
      </Card>
    </div>
  );
}
