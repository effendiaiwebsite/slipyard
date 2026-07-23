import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { InPersonSign } from "./in-person-sign";

export const metadata = { title: "Sign in person" };

/**
 * In-person signing surface (M6): the signer signs on the firm's own device
 * inside the authenticated staff session (ADR-0026). Gated by signatures.manage
 * on the request's client.
 */
export default async function InPersonSignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();

  const request = await ctx.scope.getSignatureRequest(id);
  if (!request) notFound();
  const client = await ctx.scope.getClient(request.clientId);
  if (!client) notFound();

  const canManage =
    !ctx.readOnly &&
    can(
      ctx.actor,
      "signatures.manage",
      {
        orgId: request.orgId,
        type: "signature_request",
        id: request.id,
        assignedTo: client.assignedAccountantId,
      },
      ctx.orgSettings
    );
  if (!canManage) notFound();

  if (request.status === "signed") redirect(`/app/esign/${id}`);
  if (request.status === "declined" || request.status === "canceled") redirect(`/app/esign/${id}`);
  if (request.placements.length === 0) redirect(`/app/esign/${id}`);

  return (
    <div className="p-6 space-y-5 max-w-xl">
      <div className="text-xs text-slate-500">
        <Link href={`/app/esign/${id}`} className="hover:underline">
          ← Back to the request
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in person</h1>
        <p className="text-sm text-slate-500 mt-1">
          Hand the device to {request.signerName} to sign &ldquo;{request.title}&rdquo;.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Signature</CardTitle>
        </CardHeader>
        <CardContent>
          <InPersonSign requestId={id} signerName={request.signerName} />
        </CardContent>
      </Card>
    </div>
  );
}
