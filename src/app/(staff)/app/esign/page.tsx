import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStaff } from "@/lib/context";
import { authorize } from "@/lib/permissions";
import { SIGNATURE_STATUS_META, isOpenSignatureStatus } from "@/lib/esign-meta";

export const metadata = { title: "E-signatures" };

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-CA");

/**
 * E-signature dashboard (M6): every signature request with its status. The
 * "out for signature" surface — draft/sent/viewed are open, signed/declined/
 * cancelled are settled. Requests are created from a client's Documents card.
 */
export default async function EsignPage() {
  const ctx = await requireStaff();
  await authorize(ctx.scope, ctx.actor, "signatures.view", undefined, {
    orgSettings: ctx.orgSettings,
  });

  // Assigned-only accountants see requests for their clients only (mirrors
  // clients.view scoping); everyone else sees the whole firm's.
  const assignedOnly =
    ctx.role === "accountant" && ctx.orgSettings.accountant_scope_mode === "assigned_only";
  const rows = await ctx.scope.listSignatureRequests(
    assignedOnly ? { assignedToId: ctx.user.id } : undefined
  );

  const open = rows.filter((r) => isOpenSignatureStatus(r.request.status));
  const settled = rows.filter((r) => !isOpenSignatureStatus(r.request.status));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">E-signatures</h1>
        <p className="text-sm text-slate-500 mt-1">
          Send a form for signature from a client&apos;s Documents card, then track it here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Out for signature ({open.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing is waiting to be signed.</p>
          ) : (
            <RequestTable rows={open} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Completed &amp; closed</CardTitle>
        </CardHeader>
        <CardContent>
          {settled.length === 0 ? (
            <p className="text-sm text-slate-400">No completed requests yet.</p>
          ) : (
            <RequestTable rows={settled} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Row = {
  request: {
    id: string;
    title: string;
    status: keyof typeof SIGNATURE_STATUS_META;
    mode: "remote" | "in_person";
    createdAt: Date;
    signedAt: Date | null;
  };
  clientName: string;
  createdByName: string | null;
};

function RequestTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
            <th className="py-2 pr-3 font-medium">Form</th>
            <th className="py-2 pr-3 font-medium">Client</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Mode</th>
            <th className="py-2 pr-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ request: r, clientName }) => {
            const meta = SIGNATURE_STATUS_META[r.status];
            return (
              <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/app/esign/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-slate-700">{clientName}</td>
                <td className="py-2 pr-3">
                  <Badge variant={meta.badge}>{meta.label}</Badge>
                </td>
                <td className="py-2 pr-3 text-slate-500">
                  {r.mode === "remote" ? "Remote" : "In person"}
                </td>
                <td className="py-2 pr-3 text-slate-500 tabular-nums">
                  {fmt(r.signedAt ?? r.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
