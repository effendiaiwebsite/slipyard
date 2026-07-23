import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENGAGEMENT_TYPE_LABELS } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { SIGNATURE_STATUS_META } from "@/lib/esign-meta";
import { can, PermissionError, authorize } from "@/lib/permissions";
import { readPdfPageSizes } from "@/lib/pdf";
import { getObjectBuffer } from "@/lib/storage";
import { DraftEditor } from "./draft-editor";
import { SignedActions } from "./signed-actions";

export const metadata = { title: "Signature request" };

const fmtDateTime = (d: Date) => new Date(d).toLocaleString("en-CA");

export default async function SignatureRequestPage({
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

  // View gate with assigned-only 404 (no existence leak), like client detail.
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "clients.view",
      { orgId: client.orgId, type: "client", id: client.id, assignedTo: client.assignedAccountantId },
      { orgSettings: ctx.orgSettings }
    );
  } catch (e) {
    if (e instanceof PermissionError) notFound();
    throw e;
  }

  const requestResource = {
    orgId: request.orgId,
    type: "signature_request",
    id: request.id,
    assignedTo: client.assignedAccountantId,
  };
  const canManage = !ctx.readOnly && can(ctx.actor, "signatures.manage", requestResource, ctx.orgSettings);

  const meta = SIGNATURE_STATUS_META[request.status];

  // Page geometry for the placement boxes. Falls back to US Letter if the
  // source can't be read (e.g. S3 unavailable) so the editor still works.
  let pages: { width: number; height: number }[] = [{ width: 612, height: 792 }];
  try {
    const source = await ctx.scope.getDocument(request.documentId);
    if (source) pages = await readPdfPageSizes(await getObjectBuffer(source.s3Key));
  } catch {
    /* keep the Letter fallback */
  }
  if (pages.length === 0) pages = [{ width: 612, height: 792 }];

  const engagements = (await ctx.scope.listEngagementsForClients([client.id])).map((e) => ({
    id: e.engagement.id,
    label: `${ENGAGEMENT_TYPE_LABELS[e.engagement.type]} ${e.engagement.taxYear}`,
  }));

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">
            <Link href="/app/esign" className="hover:underline">
              E-signatures
            </Link>{" "}
            ·{" "}
            <Link href={`/app/clients/${client.id}`} className="hover:underline">
              {client.displayName}
            </Link>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{request.title}</h1>
            <Badge variant={meta.badge}>{meta.label}</Badge>
          </div>
        </div>
      </div>

      {request.status === "draft" && canManage ? (
        <DraftEditor
          requestId={request.id}
          pages={pages}
          initial={{
            title: request.title,
            mode: request.mode,
            signerName: request.signerName,
            signerEmail: request.signerEmail ?? "",
            signerPhone: request.signerPhone ?? "",
            engagementId: request.engagementId,
            placements: request.placements,
          }}
          engagements={engagements}
        />
      ) : (
        <RequestSummary
          request={request}
          canManage={canManage}
          signedDocReady={!!request.signedDocumentId}
          pages={pages}
        />
      )}
    </div>
  );
}

function RequestSummary({
  request,
  canManage,
  signedDocReady,
  pages,
}: {
  request: {
    id: string;
    status: keyof typeof SIGNATURE_STATUS_META;
    mode: "remote" | "in_person";
    signerName: string;
    signerEmail: string | null;
    signerPhone: string | null;
    placements: { id: string }[];
    sentAt: Date | null;
    viewedAt: Date | null;
    signedAt: Date | null;
    declinedAt: Date | null;
    canceledAt: Date | null;
    declineReason: string | null;
    signatureMethod: string | null;
    signedVia: string | null;
    signedIp: string | null;
  };
  canManage: boolean;
  signedDocReady: boolean;
  pages: { width: number; height: number }[];
}) {
  const openForSigning =
    request.status === "sent" || request.status === "viewed";

  const timeline: [string, Date | null][] = [
    ["Sent", request.sentAt],
    ["Viewed", request.viewedAt],
    ["Signed", request.signedAt],
    ["Declined", request.declinedAt],
    ["Cancelled", request.canceledAt],
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm">
              {timeline
                .filter(([, d]) => d)
                .map(([label, d]) => (
                  <li key={label} className="flex gap-3">
                    <span className="w-24 shrink-0 text-slate-500">{label}</span>
                    <span className="text-slate-800 tabular-nums">{fmtDateTime(d!)}</span>
                  </li>
                ))}
            </ul>
            {request.status === "declined" && request.declineReason && (
              <p className="text-sm text-red-700">Reason: {request.declineReason}</p>
            )}

            {(openForSigning || request.status === "signed") && (
              <SignedActions
                requestId={request.id}
                status={request.status}
                canManage={canManage}
                signedDocReady={signedDocReady}
                canSignInPerson={openForSigning && canManage}
              />
            )}
          </CardContent>
        </Card>

        {request.status === "signed" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Signature audit</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <Row label="Method">
                  {request.signatureMethod === "typed" ? "Typed name" : "Drawn on screen"}
                </Row>
                <Row label="How">
                  {request.signedVia === "portal" ? "Remotely via the client portal" : "In person"}
                </Row>
                <Row label="IP">{request.signedIp ?? "—"}</Row>
                <Row label="Signed at">
                  {request.signedAt ? fmtDateTime(request.signedAt) : "—"}
                </Row>
              </dl>
              <p className="mt-3 text-xs text-slate-500">
                The full audit trail (source hash, token id) is on the last page of the signed PDF.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Signer</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Name">{request.signerName}</Row>
              <Row label="Email">{request.signerEmail ?? "—"}</Row>
              <Row label="Phone">{request.signerPhone ?? "—"}</Row>
              <Row label="Mode">{request.mode === "remote" ? "Remote" : "In person"}</Row>
              <Row label="Fields">
                {request.placements.length} on {pages.length}{" "}
                {pages.length === 1 ? "page" : "pages"}
              </Row>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-800 min-w-0">{children}</dd>
    </div>
  );
}
