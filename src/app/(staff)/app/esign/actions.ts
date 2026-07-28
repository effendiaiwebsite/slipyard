"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/context";
import {
  cancelSignatureRequest,
  decodeSignatureMark,
  executeSignatureRequest,
  sendSignatureRequest,
  signatureMarkSchema,
} from "@/lib/esign";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import { phonePreprocess } from "@/lib/phone";
import { presignDownloadUrl, presignInlineUrl } from "@/lib/storage";
import type { schema } from "@/db";

/**
 * E-signature staff mutations (M6). Same discipline as the rest of the CRM:
 * requireStaff → zod → authorize() (audited) → OrgScope / esign lib. Creating,
 * placing fields, sending, cancelling, in-person signing, and downloading the
 * executed PDF all live here.
 */

type SignatureRequestRow = typeof schema.signatureRequest.$inferSelect;

export type EsignActionResult = {
  error?: string;
  ok?: boolean;
  requestId?: string;
  url?: string;
};

const uuid = z.string().uuid();

async function tryAuthorize(...args: Parameters<typeof authorize>): Promise<string | null> {
  try {
    await authorize(...args);
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** signatures.manage on a request, scoped to the request's client accountant. */
async function authorizeManage(
  ctx: StaffContext,
  request: SignatureRequestRow,
  details: Record<string, unknown>
): Promise<string | null> {
  const client = await ctx.scope.getClient(request.clientId);
  return tryAuthorize(
    ctx.scope,
    ctx.actor,
    "signatures.manage",
    {
      orgId: request.orgId,
      type: "signature_request",
      id: request.id,
      assignedTo: client?.assignedAccountantId,
    },
    { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details }
  );
}

const placementSchema = z.object({
  id: z.string().min(1).max(60),
  page: z.number().int().min(0).max(500),
  xPct: z.number().min(0).max(1),
  yPct: z.number().min(0).max(1),
  wPct: z.number().min(0.01).max(1),
  hPct: z.number().min(0.005).max(1),
  kind: z.enum(["signature", "initials", "date"]),
});

/**
 * Start a draft signature request from a clean vault PDF. Staff then place
 * fields and send it. Returns the new request id for the client to navigate to.
 */
export async function createSignatureRequestForDocument(
  documentId: string,
  opts?: { engagementId?: string }
): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(documentId).success) return { error: "Invalid document" };

  const doc = await ctx.scope.getDocument(documentId);
  if (!doc) return { error: "Document not found" };
  if (doc.status !== "clean") {
    return { error: "Only a scanned-clean document can be sent for signature." };
  }
  if (doc.contentType !== "application/pdf") {
    return { error: "Only PDF documents can be signed." };
  }
  const client = await ctx.scope.getClient(doc.clientId);
  if (!client) return { error: "Client not found" };

  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "signatures.manage",
    {
      orgId: doc.orgId,
      type: "signature_request",
      assignedTo: client.assignedAccountantId,
    },
    {
      readOnlyOrg: ctx.readOnly,
      orgSettings: ctx.orgSettings,
      details: { op: "create", documentId },
    }
  );
  if (denied) return { error: denied };

  const engagementId = opts?.engagementId ?? doc.engagementId ?? null;
  const request = await ctx.scope.createSignatureRequest({
    clientId: client.id,
    documentId: doc.id,
    engagementId,
    title: titleFromFilename(doc.filename),
    mode: "remote",
    signerName: client.displayName,
    signerEmail: client.email,
    signerPhone: client.phone,
    placements: [],
    createdBy: ctx.user.id,
  });

  revalidatePath("/app/esign");
  revalidatePath(`/app/clients/${client.id}`);
  return { ok: true, requestId: request.id };
}

const updateDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: z.enum(["remote", "in_person"]),
  signerName: z.string().trim().min(1).max(200),
  signerEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  // Any common format accepted, normalised to E.164 (lib/phone.ts) — this is
  // the number the portal OTP will be texted to (ADR-0042), so it must be real.
  signerPhone: z.preprocess(
    phonePreprocess,
    z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/, "That doesn't look like a Canadian phone number — 10 digits, any format.")
      .or(z.literal(""))
      .optional()
  ),
  engagementId: z.string().uuid().nullable().optional(),
  placements: z.array(placementSchema).max(50),
});

/** Save the draft: signer/mode config + field placements (one round trip). */
export async function updateSignatureDraft(
  requestId: string,
  input: unknown
): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };
  const parsed = updateDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "Signature request not found" };
  if (request.status !== "draft") return { error: "Only a draft can be edited." };

  const denied = await authorizeManage(ctx, request, { op: "update_draft" });
  if (denied) return { error: denied };

  // Engagement, if given, must belong to the signer client.
  let engagementId = parsed.data.engagementId ?? null;
  if (engagementId) {
    const eng = await ctx.scope.getEngagement(engagementId);
    if (!eng || eng.clientId !== request.clientId) engagementId = null;
  }

  await ctx.scope.updateSignatureRequest(requestId, {
    title: parsed.data.title,
    mode: parsed.data.mode,
    signerName: parsed.data.signerName,
    signerEmail: parsed.data.signerEmail || null,
    signerPhone: parsed.data.signerPhone || null,
    engagementId,
    placements: parsed.data.placements,
  });
  revalidatePath(`/app/esign/${requestId}`);
  return { ok: true };
}

/** Send a draft: notify the signer, advance the engagement (remote), or arm
 *  in-person signing. Requires at least one placed field. */
export async function sendSignature(requestId: string): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "Signature request not found" };
  if (request.status !== "draft") return { error: "This request has already been sent." };
  if (request.placements.length === 0) {
    return { error: "Place at least one signature field before sending." };
  }
  if (request.mode === "remote" && !request.signerPhone && !request.signerEmail) {
    return { error: "Add a phone or email for the signer before sending remotely." };
  }

  const denied = await authorizeManage(ctx, request, { op: "send", mode: request.mode });
  if (denied) return { error: denied };

  const client = await ctx.scope.getClient(request.clientId);
  if (!client) return { error: "Client not found" };

  await sendSignatureRequest(ctx.scope, request, client);
  revalidatePath("/app/esign");
  revalidatePath(`/app/esign/${requestId}`);
  revalidatePath(`/app/clients/${request.clientId}`);
  revalidatePath("/app/workflow");
  return { ok: true };
}

/** Withdraw a request before it's signed. */
export async function cancelSignature(requestId: string): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "Signature request not found" };
  if (request.status === "signed") return { error: "A signed request can't be cancelled." };
  if (request.status === "canceled") return { ok: true };

  const denied = await authorizeManage(ctx, request, { op: "cancel" });
  if (denied) return { error: denied };

  await cancelSignatureRequest(ctx.scope, request);
  revalidatePath("/app/esign");
  revalidatePath(`/app/esign/${requestId}`);
  return { ok: true };
}

/** In-person signing on the staff device: stamp + execute now. */
export async function executeInPersonSignature(
  requestId: string,
  markInput: unknown
): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };
  const parsedMark = signatureMarkSchema.safeParse(markInput);
  if (!parsedMark.success) return { error: "A signature is required." };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "Signature request not found" };
  if (request.status === "signed") return { error: "This request is already signed." };
  if (request.status === "declined" || request.status === "canceled") {
    return { error: "This request is closed." };
  }
  if (request.placements.length === 0) {
    return { error: "Place at least one signature field before signing." };
  }

  const denied = await authorizeManage(ctx, request, { op: "execute_in_person" });
  if (denied) return { error: denied };

  const mark = decodeSignatureMark(parsedMark.data);
  if (!mark) return { error: "The signature image wasn't valid. Please try again." };

  const client = await ctx.scope.getClient(request.clientId);
  if (!client) return { error: "Client not found" };

  await executeSignatureRequest(ctx.scope, {
    request,
    client,
    mark,
    signedVia: "in_person",
    ip: await clientIp(),
    staffId: ctx.user.id,
    operatorName: ctx.user.name,
  });

  revalidatePath("/app/esign");
  revalidatePath(`/app/esign/${requestId}`);
  revalidatePath(`/app/clients/${request.clientId}`);
  return { ok: true };
}

/** 5-minute presigned download of the executed PDF. */
export async function getSignedDownloadUrl(requestId: string): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request || !request.signedDocumentId) return { error: "No signed document yet." };

  const client = await ctx.scope.getClient(request.clientId);
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "signatures.view",
    {
      orgId: request.orgId,
      type: "signature_request",
      id: request.id,
      assignedTo: client?.assignedAccountantId,
    },
    { orgSettings: ctx.orgSettings, details: { op: "download_signed" } }
  );
  if (denied) return { error: denied };

  const doc = await ctx.scope.getDocument(request.signedDocumentId);
  if (!doc || doc.status !== "clean") return { error: "The signed document isn't available." };
  const url = await presignDownloadUrl(doc.s3Key, doc.filename, doc.contentType);
  return { ok: true, url };
}

/** 5-minute inline presigned URL of the SOURCE PDF, for viewing it in a tab
 *  while placing fields / before signing. */
export async function getSourceViewUrl(requestId: string): Promise<EsignActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(requestId).success) return { error: "Invalid request" };

  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "Signature request not found" };

  const client = await ctx.scope.getClient(request.clientId);
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "signatures.view",
    {
      orgId: request.orgId,
      type: "signature_request",
      id: request.id,
      assignedTo: client?.assignedAccountantId,
    },
    { orgSettings: ctx.orgSettings, details: { op: "view_source" } }
  );
  if (denied) return { error: denied };

  const doc = await ctx.scope.getDocument(request.documentId);
  if (!doc || doc.status !== "clean") return { error: "The document isn't available." };
  const url = await presignInlineUrl(doc.s3Key, doc.filename, doc.contentType);
  return { ok: true, url };
}

function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename).slice(0, 200) || "Document";
}
