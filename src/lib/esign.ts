import "server-only";
import { z } from "zod";
import type { OrgScope } from "@/db/scoped";
import type { schema } from "@/db";
import { STAGE_CATEGORIES } from "@/db/schema";
import { sendClientMessage, type ClientRecipient } from "@/lib/client-messaging";
import { logger } from "@/lib/logger";
import {
  formatCraTimestamp,
  hashBytes,
  stampSignature,
  type SignatureMark,
} from "@/lib/pdf";
import { getObjectBuffer, putObject, sanitizeFilename, signedKey } from "@/lib/storage";

/**
 * E-signature orchestration (M6). The domain steps between the repository
 * (OrgScope) and the handlers (staff actions / portal actions):
 *
 *   send    — stamp the source hash, notify the signer (M5 messaging,
 *             outbox-first), advance the linked engagement to the first
 *             awaiting_signature-category stage (ADR-0027).
 *   execute — stamp the mark + CRA timestamp + audit page into a NEW immutable
 *             object (org/{orgId}/signed/, source 'esign_executed'), mark the
 *             request signed, log the contact + audit.
 *   view / decline / cancel — lifecycle transitions with audit.
 *
 * Permission + read-only checks live in the calling handler (authorize());
 * these functions assume the caller is entitled and focus on the domain work.
 */

type SignatureRequestRow = typeof schema.signatureRequest.$inferSelect;
type ClientRow = typeof schema.client.$inferSelect;

const AWAITING_SIGNATURE_INDEX = STAGE_CATEGORIES.indexOf("awaiting_signature");

/** Client row → the recipient shape the messaging layer consumes. */
export function toRecipient(c: ClientRow): ClientRecipient {
  return {
    id: c.id,
    displayName: c.displayName,
    email: c.email,
    phone: c.phone,
    preferredChannel: c.preferredChannel,
    smsOptOutAt: c.smsOptOutAt,
  };
}

/**
 * Move a linked engagement FORWARD to the first awaiting_signature-category
 * stage, if the pipeline has one and the engagement isn't already there or
 * past it (ADR-0027; mirrors auto-advance's category-keyed, forward-only
 * posture, ADR-0017). No-op otherwise. Audited as system.
 */
export async function advanceEngagementForSignature(
  scope: OrgScope,
  engagementId: string
): Promise<void> {
  const engagement = await scope.getEngagement(engagementId);
  if (!engagement) return;
  const stages = await scope.listStages();
  const current = stages.find((s) => s.id === engagement.stageId);
  if (!current) return;
  const currentIdx = STAGE_CATEGORIES.indexOf(current.category);
  // Already at/beyond awaiting_signature — don't drag it backwards or churn.
  if (currentIdx >= AWAITING_SIGNATURE_INDEX) return;
  const target = stages
    .slice()
    .sort((a, b) => a.position - b.position)
    .find((s) => s.category === "awaiting_signature");
  if (!target) return; // custom pipeline without a signature stage — silently skip

  await scope.transitionEngagement(engagementId, target.id);
  await scope.writeAudit({
    actorType: "system",
    action: "esign.stage_advanced",
    resourceType: "engagement",
    resourceId: engagementId,
    details: { toStage: target.key, category: "awaiting_signature" },
  });
}

/**
 * Send a draft request: compute + store the source hash, notify the signer,
 * advance the engagement. Returns the updated request. Notification failures
 * never block the send (the row records the outcome, ADR-0022).
 */
export async function sendSignatureRequest(
  scope: OrgScope,
  request: SignatureRequestRow,
  client: ClientRow
): Promise<SignatureRequestRow> {
  // Source hash captured at send time — the audit page attests to exactly
  // these bytes.
  let sourceHash = request.sourceHash;
  try {
    const source = await scope.getDocument(request.documentId);
    if (source) sourceHash = hashBytes(await getObjectBuffer(source.s3Key));
  } catch (e) {
    logger.warn(
      { requestId: request.id, err: e instanceof Error ? e.message : String(e) },
      "could not hash source PDF at send"
    );
  }

  const updated =
    (await scope.updateSignatureRequest(request.id, {
      status: "sent",
      sentAt: new Date(),
      sourceHash,
    })) ?? request;

  await scope.writeAudit({
    actorType: scope.userId ? "staff" : "system",
    action: "esign.sent",
    resourceType: "signature_request",
    resourceId: request.id,
    details: { mode: request.mode, title: request.title },
  });

  // Notify the signer through the M5 client-messaging layer (remote only —
  // in-person requests are signed on the spot, no message needed).
  if (request.mode === "remote") {
    try {
      await sendClientMessage(scope, {
        client: toRecipient(client),
        engagementId: request.engagementId,
        kind: "manual",
        requestedChannel: "preferred",
        subject: `A form is ready for your signature`,
        body:
          `Hello ${client.displayName}, your accountant has prepared "${request.title}" for ` +
          `you to review and sign. Open your secure portal link to sign it. If you don't have ` +
          `your link handy, call the office and we'll send a new one.`,
        contactSummary: `Sent signature request "${request.title}"`,
      });
    } catch (e) {
      logger.warn(
        { requestId: request.id, err: e instanceof Error ? e.message : String(e) },
        "signature-request notification failed"
      );
    }
  }

  if (request.engagementId) {
    await advanceEngagementForSignature(scope, request.engagementId);
  }

  return updated;
}

export type ExecuteInput = {
  request: SignatureRequestRow;
  client: ClientRow;
  mark: SignatureMark;
  signedVia: "portal" | "in_person";
  ip: string | null;
  /** Remote: the portal token id whose OTP authenticated the signer. */
  tokenId?: string | null;
  /** In-person: the staff user operating the device. */
  staffId?: string | null;
  operatorName?: string | null;
};

/**
 * Execute a signature: stamp the source PDF and persist the executed copy as a
 * new immutable document (never overwriting the source). Returns the updated
 * request (status 'signed').
 */
export async function executeSignatureRequest(
  scope: OrgScope,
  input: ExecuteInput
): Promise<SignatureRequestRow> {
  const { request } = input;
  const org = await scope.getOrg();
  const timezone = org?.timezone ?? "America/Toronto";
  const firmName = org?.name ?? "Your accountant";

  const source = await scope.getDocument(request.documentId);
  if (!source) throw new Error("source document missing");
  const sourceBytes = await getObjectBuffer(source.s3Key);
  const sourceHash = request.sourceHash ?? hashBytes(sourceBytes);

  const signedAt = new Date();
  const timestampText = formatCraTimestamp(signedAt, timezone);

  const executed = await stampSignature({
    source: sourceBytes,
    placements: request.placements,
    mark: input.mark,
    timestampText,
    audit: {
      title: request.title,
      signerName: request.signerName,
      signerEmail: request.signerEmail,
      signerPhone: request.signerPhone,
      signedVia: input.signedVia,
      method: input.mark.method,
      timestampText,
      timezone,
      ip: input.ip,
      tokenId: input.tokenId ?? null,
      operatorName: input.operatorName ?? null,
      sourceHash,
      requestId: request.id,
      firmName,
    },
  });
  const executedBuffer = Buffer.from(executed);
  const signedHash = hashBytes(executedBuffer);

  // New document row for the executed PDF — immutable, source 'esign_executed'.
  const signedFilename = sanitizeFilename(signedName(source.filename));
  let signedDoc = await scope.createDocument({
    clientId: request.clientId,
    engagementId: request.engagementId,
    filename: signedFilename,
    contentType: "application/pdf",
    sizeBytes: executedBuffer.byteLength,
    s3Key: "",
    status: "clean",
    source: "esign_executed",
    uploadedBy: input.staffId ?? null,
  });
  const key = signedKey(scope.orgId, signedDoc.id, signedFilename);
  await putObject(key, executedBuffer, "application/pdf");
  signedDoc = (await scope.updateDocument(signedDoc.id, { s3Key: key })) ?? signedDoc;

  const updated =
    (await scope.updateSignatureRequest(request.id, {
      status: "signed",
      signedAt,
      sourceHash,
      signedDocumentId: signedDoc.id,
      signedHash,
      signatureMethod: input.mark.method,
      signedVia: input.signedVia,
      signedIp: input.ip,
      signedTokenId: input.tokenId ?? null,
      signedByStaffId: input.staffId ?? null,
    })) ?? request;

  await scope.writeAudit({
    actorType: input.signedVia === "portal" ? "client" : "staff",
    action: "esign.signed",
    resourceType: "signature_request",
    resourceId: request.id,
    ip: input.ip ?? undefined,
    details: {
      method: input.mark.method,
      via: input.signedVia,
      signedDocumentId: signedDoc.id,
      signedHash,
    },
  });

  await scope.addContactLog({
    clientId: request.clientId,
    channel: input.signedVia === "portal" ? "other" : "meeting",
    summary: `Signed "${request.title}" (${input.signedVia === "portal" ? "remotely via portal" : "in person"})`,
  });

  return updated;
}

/** Signer opened the signing surface (best-effort; only bumps sent→viewed). */
export async function markSignatureViewed(
  scope: OrgScope,
  request: SignatureRequestRow
): Promise<void> {
  if (request.status !== "sent") return;
  await scope.updateSignatureRequest(request.id, { status: "viewed", viewedAt: new Date() });
  await scope.writeAudit({
    actorType: "client",
    action: "esign.viewed",
    resourceType: "signature_request",
    resourceId: request.id,
  });
}

export async function declineSignatureRequest(
  scope: OrgScope,
  request: SignatureRequestRow,
  reason: string | null,
  via: "portal" | "in_person",
  ip: string | null
): Promise<SignatureRequestRow> {
  const updated =
    (await scope.updateSignatureRequest(request.id, {
      status: "declined",
      declinedAt: new Date(),
      declineReason: reason,
    })) ?? request;
  await scope.writeAudit({
    actorType: via === "portal" ? "client" : "staff",
    action: "esign.declined",
    resourceType: "signature_request",
    resourceId: request.id,
    ip: ip ?? undefined,
    details: { reason: reason ?? undefined },
  });
  await scope.addContactLog({
    clientId: request.clientId,
    channel: "other",
    summary: `Declined to sign "${request.title}"`,
  });
  return updated;
}

export async function cancelSignatureRequest(
  scope: OrgScope,
  request: SignatureRequestRow
): Promise<SignatureRequestRow> {
  const updated =
    (await scope.updateSignatureRequest(request.id, {
      status: "canceled",
      canceledAt: new Date(),
    })) ?? request;
  await scope.writeAudit({
    actorType: scope.userId ? "staff" : "system",
    action: "esign.canceled",
    resourceType: "signature_request",
    resourceId: request.id,
  });
  return updated;
}

/**
 * Shared validation for a client-supplied signature mark (staff in-person +
 * portal remote both post this). Kept here so both handlers decode identically.
 */
export const signatureMarkSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("drawn"), png: z.string().min(1).max(3_000_000) }),
  z.object({ method: z.literal("typed"), name: z.string().trim().min(1).max(120) }),
]);
export type SignatureMarkInput = z.infer<typeof signatureMarkSchema>;

/** Decode a validated mark into the pdf SignatureMark, or null if the PNG is bad. */
export function decodeSignatureMark(input: SignatureMarkInput): SignatureMark | null {
  if (input.method === "typed") return { method: "typed", name: input.name };
  const base64 = input.png.replace(/^data:image\/png;base64,/, "");
  const png = Buffer.from(base64, "base64");
  const isPng =
    png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  return isPng ? { method: "drawn", png } : null;
}

/** "T183.pdf" → "T183 - signed.pdf" (sanitize-safe — no parentheses, which
 *  storage.sanitizeFilename would turn into underscores). */
function signedName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base} - signed.pdf`;
}
