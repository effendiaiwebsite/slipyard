import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { ClientsTable, type ClientRow } from "./clients-table";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const ctx = await requireStaff();

  // Accountants in assigned_only orgs see just their book (ADR-0004);
  // filtering/search happens client-side on the already-scoped rows.
  const rows = await ctx.scope.listClientsWithMeta({
    assignedToId: viewAssignedOnlyFilter(ctx),
  });

  const canCreate =
    !ctx.readOnly && can(ctx.actor, "clients.create", { orgId: ctx.orgId, type: "client" });

  // Bulk distribute is a firm-wide reassignment: clients.update with no
  // specific assignee → owner/admin only (accountants fail the 'assigned' rule).
  const canDistribute =
    !ctx.readOnly && can(ctx.actor, "clients.update", { orgId: ctx.orgId, type: "client" });

  // Assignable accountants = active, non-clerk staff (the same rule the
  // per-client picker uses). Clerks hold no client book.
  const assignableAccountants = canDistribute
    ? (await ctx.scope.listMemberships())
        .filter((m) => m.membership.status === "active" && m.membership.role !== "clerk")
        .map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email }))
    : [];

  const data: ClientRow[] = rows.map((r) => ({
    id: r.client.id,
    name: r.client.displayName,
    type: r.client.type,
    status: r.client.status,
    sinMasked: r.client.sinLast3 ? `*** *** ${r.client.sinLast3}` : null,
    stageLabel: r.latestEngagement?.stage.label ?? null,
    stageCategory: r.latestEngagement?.stage.category ?? null,
    engagementLabel: r.latestEngagement
      ? `${r.latestEngagement.engagement.type.toUpperCase()} ${r.latestEngagement.engagement.taxYear}`
      : null,
    owner: r.assignedName,
    household: r.householdName,
    lastContact: r.lastContactAt ? r.lastContactAt.toISOString() : null,
    tags: r.client.tags,
    city: r.client.city,
  }));

  const active = data.filter((d) => d.status === "active").length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Clients</div>
          <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-slate-600 mt-1">
            {active} active · {data.length - active} archived
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/app/clients/households">Households</Link>
          </Button>
          {canCreate && (
            <Button asChild>
              <Link href="/app/clients/new">
                <Plus /> New client
              </Link>
            </Button>
          )}
        </div>
      </div>
      <ClientsTable
        data={data}
        accountants={assignableAccountants}
        canDistribute={canDistribute}
      />
    </div>
  );
}
