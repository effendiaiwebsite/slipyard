import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENGAGEMENT_TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { IntakeQueue, IntakeUploadForm } from "./intake-client";

export const metadata = { title: "Document intake" };

/**
 * Intake queue (M3): documents uploaded without an engagement wait here to
 * be filed. The clerk's whole document world: upload yes, file no.
 */
export default async function IntakePage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);

  const [docs, clients, engagements, missingItems] = await Promise.all([
    ctx.scope.listIntakeDocuments(),
    ctx.scope.listClientsWithMeta({ status: "active", assignedToId: assignedOnly }),
    ctx.scope.listEngagementsWithMeta({ assignedToId: assignedOnly }),
    ctx.scope.listMissingChecklistItems(),
  ]);

  // UI gate only — the server actions re-check per resource (accountants
  // may still be denied on unassigned clients).
  const canManage =
    !ctx.readOnly &&
    can(ctx.actor, "documents.manage", { orgId: ctx.orgId, type: "document", assignedTo: ctx.user.id });
  const canUpload = !ctx.readOnly && can(ctx.actor, "documents.intake_upload");

  const visibleClientIds = assignedOnly ? new Set(clients.map((c) => c.client.id)) : null;
  const visibleDocs = visibleClientIds
    ? docs.filter((d) => visibleClientIds.has(d.document.clientId))
    : docs;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Document intake</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Everything uploaded lands in quarantine, gets virus-scanned, and waits here until it&apos;s
            filed against a return.
          </p>
        </div>
        {canUpload && (
          <Link
            href="/app/documents/bulk"
            className="text-sm text-indigo-600 hover:underline whitespace-nowrap"
          >
            Bulk upload for one client →
          </Link>
        )}
      </div>

      {canUpload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Upload for a client</CardTitle>
          </CardHeader>
          <CardContent>
            <IntakeUploadForm
              clients={clients.map((c) => ({ id: c.client.id, name: c.client.displayName }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Queue · {visibleDocs.length} document{visibleDocs.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <IntakeQueue
            canManage={canManage}
            docs={visibleDocs.map(({ document: d, clientName, uploaderName }) => ({
              id: d.id,
              filename: d.filename,
              status: d.status,
              sizeBytes: d.sizeBytes,
              createdAt: d.createdAt.toISOString(),
              clientId: d.clientId,
              clientName,
              uploaderName,
              scanResult: d.status === "infected" || d.status === "scan_failed" ? d.scanResult : null,
            }))}
            engagements={engagements.map((e) => ({
              id: e.engagement.id,
              clientId: e.engagement.clientId,
              label: `${ENGAGEMENT_TYPE_LABELS[e.engagement.type]} ${e.engagement.taxYear} — ${e.stage.label}`,
            }))}
            missingItems={missingItems.map((i) => ({
              id: i.id,
              engagementId: i.engagementId,
              title: i.required ? `${i.title} *` : i.title,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
