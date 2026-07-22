import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { updateClient } from "../../actions";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();

  const c = await ctx.scope.getClient(id);
  if (!c) notFound();

  const resource = { orgId: c.orgId, type: "client", id: c.id, assignedTo: c.assignedAccountantId };
  if (ctx.readOnly || !can(ctx.actor, "clients.update", resource, ctx.orgSettings)) {
    redirect(`/app/clients/${id}`);
  }

  const [memberships, households] = await Promise.all([
    ctx.scope.listMemberships(),
    ctx.scope.listHouseholds(),
  ]);
  const members = memberships
    .filter((m) => m.membership.status === "active" && m.membership.role !== "clerk")
    .map((m) => ({ id: m.user.id, name: m.user.name }));

  const boundUpdate = updateClient.bind(null, c.id);

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-xs text-slate-500 mb-0.5">Clients · {c.displayName} · Edit</div>
        <h1 className="text-xl font-semibold tracking-tight">Edit client</h1>
      </div>
      <ClientForm
        action={boundUpdate}
        initial={{
          displayName: c.displayName,
          type: c.type,
          email: c.email ?? "",
          phone: c.phone ?? "",
          preferredChannel: c.preferredChannel,
          addressLine1: c.addressLine1 ?? "",
          city: c.city ?? "",
          province: c.province ?? "",
          postalCode: c.postalCode ?? "",
          dateOfBirth: c.dateOfBirth ?? "",
          assignedAccountantId: c.assignedAccountantId ?? "",
          householdId: c.householdId ?? "",
          tags: c.tags.join(", "),
          sinOnFile: !!c.sinEncrypted,
        }}
        members={members}
        households={households.map((h) => ({ id: h.id, name: h.name }))}
        submitLabel="Save changes"
      />
    </div>
  );
}
