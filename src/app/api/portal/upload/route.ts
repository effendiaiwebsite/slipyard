import { NextResponse } from "next/server";
import { z } from "zod";
import { applyAutoAdvance } from "@/lib/checklists";
import { scanAndRouteDocument } from "@/lib/documents";
import { env, features } from "@/lib/env";
import { getPortalContext } from "@/lib/portal-context";
import { rateLimit } from "@/lib/rate-limit";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  putObject,
  quarantineKey,
  sanitizeFilename,
} from "@/lib/storage";

/**
 * Portal document upload (M4): same quarantine→scan→vault pipeline as the
 * staff route (ADR-0016), gated by the portal session cookie instead of
 * requireStaff. Documents land with source='portal_upload' and no
 * uploaded_by (clients are not staff_user rows — ADR-0001); audit entries
 * use actor_type 'client'.
 *
 * Fields: file, clientId (must be inside the token's client/household
 * scope), checklistItemId? (preselected "Send it" flow).
 */

const fieldsSchema = z.object({
  clientId: z.string().uuid(),
  checklistItemId: z.string().uuid().optional(),
});

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Same CSRF stance as the staff upload route: cookie-authed multipart POST. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(env.APP_URL).origin;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  if (crossOrigin(request)) return jsonError("Cross-origin uploads are not allowed.", 403);
  if (!features.s3) return jsonError("Document storage is not configured on this server.", 503);

  const ctx = await getPortalContext();
  if (!ctx) return jsonError("Your session has ended. Please open your link again.", 401);
  if (!ctx.scopes.includes("upload")) {
    return jsonError("This link doesn't allow sending documents.", 403);
  }
  if (!rateLimit(`portal-upload:${ctx.tokenId}`, 30, 60 * 60 * 1000)) {
    return jsonError("Too many uploads for now. Please try again in an hour.", 429);
  }

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
    checklistItemId: form.get("checklistItemId") || undefined,
  });
  if (!parsed.success) return jsonError("Invalid upload fields.", 400);
  const { clientId, checklistItemId } = parsed.data;

  if (file.size === 0) return jsonError("The file is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("File is larger than the 25 MB limit.", 413);
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return jsonError("That file type can't be accepted. Photos and PDF files work best.", 415);
  }

  // The token's scope — not the form — decides whose documents can be sent.
  const target = ctx.clients.find((c) => c.id === clientId);
  if (!target) return jsonError("That person isn't covered by this link.", 403);

  // Optional checklist slot: must belong to one of the target's engagements.
  let checklistItem = null;
  let engagementId: string | null = null;
  if (checklistItemId) {
    checklistItem = await ctx.scope.getChecklistItem(checklistItemId);
    if (!checklistItem) return jsonError("That checklist item wasn't found.", 404);
    const engagement = await ctx.scope.getEngagement(checklistItem.engagementId);
    if (!engagement || engagement.clientId !== target.id) {
      return jsonError("That checklist item wasn't found.", 404);
    }
    engagementId = engagement.id;
  }

  const filename = sanitizeFilename(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());

  let doc = await ctx.scope.createDocument({
    clientId: target.id,
    engagementId,
    filename,
    contentType: file.type,
    sizeBytes: file.size,
    s3Key: "",
    source: "portal_upload",
    uploadedBy: null,
  });
  const key = quarantineKey(ctx.orgId, doc.id, filename);
  await putObject(key, bytes, file.type);
  doc = (await ctx.scope.updateDocument(doc.id, { s3Key: key })) ?? doc;

  await ctx.scope.writeAudit({
    actorType: "client",
    action: "portal.upload",
    resourceType: "document",
    resourceId: doc.id,
    details: {
      portalTokenId: ctx.tokenId,
      clientId: target.id,
      checklistItemId,
      sizeBytes: file.size,
    },
  });

  doc = await scanAndRouteDocument(ctx.scope, doc, bytes);

  if (doc.status === "clean" && checklistItem) {
    await ctx.scope.updateChecklistItem(checklistItem.id, {
      status: "received",
      documentId: doc.id,
    });
    await applyAutoAdvance(ctx.scope, checklistItem.engagementId);
  }

  // Friendly outcome only — scanner details never reach the portal.
  return NextResponse.json({
    documentId: doc.id,
    outcome: doc.status === "clean" ? "received" : doc.status === "infected" ? "rejected" : "held",
  });
}
