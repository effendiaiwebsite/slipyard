import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { createClient } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const ctx = await requireStaff();
  if (ctx.readOnly || !can(ctx.actor, "clients.create", { orgId: ctx.orgId, type: "client" })) {
    redirect("/app/clients");
  }

  const [memberships, households] = await Promise.all([
    ctx.scope.listMemberships(),
    ctx.scope.listHouseholds(),
  ]);
  const members = memberships
    .filter((m) => m.membership.status === "active" && m.membership.role !== "clerk")
    .map((m) => ({ id: m.user.id, name: m.user.name }));

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-xs text-slate-500 mb-0.5">Practice · Clients · New</div>
        <h1 className="text-xl font-semibold tracking-tight">New client</h1>
      </div>
      <ClientForm
        action={createClient}
        members={members}
        households={households.map((h) => ({ id: h.id, name: h.name }))}
        submitLabel="Create client"
      />
    </div>
  );
}
