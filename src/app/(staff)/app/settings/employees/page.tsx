import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeesManager } from "./employees-manager";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const ctx = await requireStaff();
  const [members, invitations] = await Promise.all([
    ctx.scope.listMemberships(),
    ctx.scope.listInvitations(),
  ]);

  const canManage = can(ctx.actor, "employees.manage");
  const pendingInvites = invitations.filter((i) => !i.acceptedAt);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Employees</h1>
        <p className="text-sm text-slate-500 mt-1">
          {members.filter((m) => m.membership.status === "active").length} active seat(s) — your
          subscription quantity follows this number.
        </p>
      </div>

      {ctx.readOnly && (
        <Card>
          <CardContent className="p-4 text-sm text-amber-800 bg-amber-50 rounded-lg">
            Subscription inactive — employee management is paused until billing is restored.
          </CardContent>
        </Card>
      )}

      <EmployeesManager
        members={members.map((m) => ({
          membershipId: m.membership.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.membership.role,
          status: m.membership.status,
          isSelf: m.user.id === ctx.user.id,
        }))}
        pendingInvites={pendingInvites.map((i) => ({
          id: i.id,
          name: i.name,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
          revoked: !!i.revokedAt,
        }))}
        canManage={canManage}
        isOwner={ctx.role === "owner"}
        readOnly={ctx.readOnly}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">How invitations work</CardTitle>
          <CardDescription>
            Invitees get a link by email (and SMS if a mobile number is given). The link expires
            in 7 days. They set a password or link Google, enroll two-factor authentication, and
            land on their personal dashboard. <Badge>Dev note</Badge> until real
            email/SMS adapters land (M5), messages appear in the console and the outbox table.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
