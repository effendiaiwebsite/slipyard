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

  const data: ClientRow[] = rows.map((r) => ({
    id: r.client.id,
    name: r.client.displayName,
    type: r.client.type,
    status: r.client.status,
    sinMasked: r.client.sinLast3 ? `*** *** ${r.client.sinLast3}` : null,
    stage: r.latestEngagement?.status ?? null,
    engagementLabel: r.latestEngagement
      ? `${r.latestEngagement.type.toUpperCase()} ${r.latestEngagement.taxYear}`
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
        {canCreate && (
          <Button asChild>
            <Link href="/app/clients/new">
              <Plus /> New client
            </Link>
          </Button>
        )}
      </div>
      <ClientsTable data={data} />
    </div>
  );
}
