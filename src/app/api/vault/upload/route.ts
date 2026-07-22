import { NextResponse } from "next/server";
import { z } from "zod";
import { staffApiContext } from "@/lib/context";
import { enqueueDocumentScan, runDocumentScanJob } from "@/lib/jobs";
import { env, features } from "@/lib/env";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  putObject,
  quarantineKey,
  sanitizeFilename,
} from "@/lib/storage";

/**
 * Document upload (M3, ADR-0016; async scan M5, ADR-0021): multipart POST
 * proxied through the app — at /api/vault/upload; NOTE the path deliberately
 * avoids the earlier /api/documents/upload, which the dev machine's
 * antivirus (Norton) blacklisted after EICAR test uploads — see TESTING.md.
 * Bytes land in org/{orgId}/quarantine/ and the response returns as soon as
 * they're locked there; the ClamAV scan runs in a pg-boss job which promotes
 * to the vault (or flags) and then satisfies any checklist slot. Callers
 * poll /api/vault/scan-status. Reads never come back through here
 * (presigned GET).
 *
 * Fields: file, clientId, engagementId?, checklistItemId?.
 * Plain upload (intake) needs documents.intake_upload; uploading straight
 * onto an engagement/checklist item is a filing decision and needs
 * documents.manage.
 */

const fieldsSchema = z.object({
  clientId: z.string().uuid(),
  engagementId: z.string().uuid().optional(),
  checklistItemId: z.string().uuid().optional(),
});

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Cookie-authed multipart POST is a CSRF vector (no preflight): unlike
 * server actions, route handlers get no built-in origin check, so enforce
 * same-origin explicitly.
 */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // same-origin/non-browser clients omit it
  try {
    return new URL(origin).origin !== new URL(env.APP_URL).origin;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  if (crossOrigin(request)) return jsonError("Cross-origin uploads are not allowed.", 403);
  if (!features.s3) {
    return jsonError("Document storage is not configured on this server.", 503);
  }

  const auth = await staffApiContext();
  if (!auth.ok) return jsonError(auth.error, auth.status);
  const ctx = auth.ctx;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected a multipart form upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("No file in the upload.", 400);

  const parsed = fieldsSchema.safeParse({
    clientId: form.get("clientId") ?? undefined,
    engagementId: form.get("engagementId") || undefined,
    checklistItemId: form.get("checklistItemId") || undefined,
  });
  if (!parsed.success) return jsonError("Invalid upload fields.", 400);
  const { clientId, engagementId, checklistItemId } = parsed.data;

  if (file.size === 0) return jsonError("The file is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError("File is larger than the 25 MB limit.", 413);
  }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return jsonError("That file type isn't accepted. Use PDF, images, Office files, or CSV/text.", 415);
  }

  // Everything referenced must resolve inside this org's scope.
  const client = await ctx.scope.getClient(clientId);
  if (!client) return jsonError("Client not found.", 404);

  const engagement = engagementId ? await ctx.scope.getEngagement(engagementId) : null;
  if (engagementId && (!engagement || engagement.clientId !== clientId)) {
    return jsonError("Engagement not found for this client.", 404);
  }
  const checklistItem = checklistItemId ? await ctx.scope.getChecklistItem(checklistItemId) : null;
  if (checklistItemId && (!checklistItem || checklistItem.engagementId !== engagementId)) {
    return jsonError("Checklist item not found on this engagement.", 404);
  }

  try {
    if (engagement) {
      // Filing against a return (and possibly a checklist slot) = manage.
      await authorize(
        ctx.scope,
        ctx.actor,
        "documents.manage",
        {
          orgId: engagement.orgId,
          type: "engagement",
          id: engagement.id,
          assignedTo: engagement.assignedToId ?? client.assignedAccountantId,
        },
        {
          readOnlyOrg: ctx.readOnly,
          orgSettings: ctx.orgSettings,
          details: { op: "upload_to_engagement", checklistItemId },
        }
      );
    } else {
      await authorize(
        ctx.scope,
        ctx.actor,
        "documents.intake_upload",
        {
          orgId: client.orgId,
          type: "client",
          id: client.id,
          assignedTo: client.assignedAccountantId,
        },
        { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings }
      );
    }
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) {
      return jsonError(e.message, 403);
    }
    throw e;
  }

  const filename = sanitizeFilename(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());

  // Row first (pending_scan), then bytes to quarantine, then the verdict.
  let doc = await ctx.scope.createDocument({
    clientId,
    engagementId: engagement?.id ?? null,
    filename,
    contentType: file.type,
    sizeBytes: file.size,
    s3Key: "", // set right below once the id exists
    uploadedBy: ctx.user.id,
  });
  const key = quarantineKey(ctx.orgId, doc.id, filename);
  await putObject(key, bytes, file.type);
  doc = (await ctx.scope.updateDocument(doc.id, { s3Key: key })) ?? doc;

  // ADR-0021: hand the scan to the job runner and return. Checklist
  // satisfaction + auto-advance happen in the job on a clean verdict. When
  // the runner is off (JOBS_ENABLED=false, tests) fall back to the M3
  // synchronous path via the same job body.
  const scanJob = {
    orgId: ctx.orgId,
    documentId: doc.id,
    checklistItemId: checklistItem?.id ?? null,
  };
  if (!(await enqueueDocumentScan(scanJob))) {
    // The job body throws on scan_failed to drive pg-boss retries; inline,
    // the row already carries that status — nothing more to do.
    await runDocumentScanJob(scanJob).catch(() => {});
    doc = (await ctx.scope.getDocument(doc.id)) ?? doc;
  }

  return NextResponse.json({
    documentId: doc.id,
    status: doc.status,
    // Signature name is safe to show staff; bytes are locked in quarantine.
    scanResult: doc.status === "infected" ? doc.scanResult : undefined,
  });
}
