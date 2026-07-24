import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { HouseholdsManager, type HouseholdRow } from "./households-manager";

export const metadata = { title: "Households" };

export default async function HouseholdsPage() {
  const ctx = await requireStaff();
  const households = await ctx.scope.listHouseholdsWithMembers();

  // Same rule as bulk distribute: a firm-wide clients.update (no assignee) —
  // owner/admin only. Everyone with client access may view.
  const canManage =
    !ctx.readOnly && can(ctx.actor, "clients.update", { orgId: ctx.orgId, type: "household" });

  const rows: HouseholdRow[] = households.map((h) => ({
    id: h.id,
    name: h.name,
    members: h.members.map((m) => ({ id: m.id, displayName: m.displayName, status: m.status })),
  }));

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Clients · Households</div>
          <h1 className="text-xl font-semibold tracking-tight">Households</h1>
          <p className="text-sm text-slate-600 mt-1">
            Rename or merge household groupings — members are managed from each client&apos;s
            edit form.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/clients">← Back to clients</Link>
        </Button>
      </div>
      <HouseholdsManager households={rows} canManage={canManage} />
    </div>
  );
}
