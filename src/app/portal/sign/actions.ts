"use server";

import { headers } from "next/headers";
import {
  decodeSignatureMark,
  declineSignatureRequest,
  executeSignatureRequest,
  signatureMarkSchema,
} from "@/lib/esign";
import { getPortalContext, type PortalContext } from "@/lib/portal-context";
import { rateLimit } from "@/lib/rate-limit";
import { presignInlineUrl } from "@/lib/storage";
import type { schema } from "@/db";

/**
 * Portal remote-signing actions (M6, ADR-0026). Gated by the portal SESSION
 * (already OTP-verified), the token's 'sign' scope, and the request belonging
 * to a client inside the token's scope — the same ownership check portal
 * uploads use. Coarse errors only.
 */

type SignatureRequestRow = typeof schema.signatureRequest.$inferSelect;
type ClientRow = typeof schema.client.$inferSelect;

export type PortalSignResult = {
  error?: string;
  ok?: boolean;
  url?: string;
  done?: boolean;
};

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

type Loaded = { ctx: PortalContext; request: SignatureRequestRow; client: ClientRow };

/** Resolve a request the current portal session is entitled to sign. */
async function loadOwned(requestId: string): Promise<Loaded | { error: string }> {
  const ctx = await getPortalContext();
  if (!ctx) return { error: "Your session has ended. Please open your link again." };
  if (!ctx.scopes.includes("sign")) {
    return { error: "This link doesn't allow signing. Ask your accountant for a new link." };
  }
  const request = await ctx.scope.getSignatureRequest(requestId);
  if (!request) return { error: "We couldn't find that form." };
  const client = ctx.clients.find((c) => c.id === request.clientId);
  if (!client) return { error: "That form isn't for you." };
  return { ctx, request, client };
}

/** Inline presigned URL of the form to review before signing. */
export async function getPortalSourceUrl(requestId: string): Promise<PortalSignResult> {
  const loaded = await loadOwned(requestId);
  if ("error" in loaded) return { error: loaded.error };
  const doc = await loaded.ctx.scope.getDocument(loaded.request.documentId);
  if (!doc || doc.status !== "clean") return { error: "The form isn't available right now." };
  const url = await presignInlineUrl(doc.s3Key, doc.filename, doc.contentType);
  return { ok: true, url };
}

/** Submit the signature: stamp + execute, then land on the confirmation. */
export async function submitPortalSignature(
  requestId: string,
  markInput: unknown
): Promise<PortalSignResult> {
  const ip = await clientIp();
  if (!rateLimit(`portal-sign:${ip ?? "local"}`, 20, 10 * 60 * 1000)) {
    return { error: "Too many attempts from this device. Please wait a few minutes." };
  }
  const parsed = signatureMarkSchema.safeParse(markInput);
  if (!parsed.success) return { error: "Please add your signature first." };

  const loaded = await loadOwned(requestId);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx, request, client } = loaded;

  if (request.status === "signed") return { ok: true, done: true };
  if (request.status === "declined" || request.status === "canceled") {
    return { error: "This form is no longer open for signing." };
  }
  if (request.placements.length === 0) {
    return { error: "This form isn't ready to sign yet. Please call the office." };
  }

  const mark = decodeSignatureMark(parsed.data);
  if (!mark) return { error: "The signature wasn't valid. Please try again." };

  await executeSignatureRequest(ctx.scope, {
    request,
    client,
    mark,
    signedVia: "portal",
    ip,
    tokenId: ctx.tokenId,
  });
  return { ok: true, done: true };
}

/** Decline to sign — the office follows up. */
export async function declinePortalSignature(
  requestId: string,
  reason: string
): Promise<PortalSignResult> {
  const loaded = await loadOwned(requestId);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx, request } = loaded;
  if (request.status === "signed") return { error: "This form is already signed." };
  if (request.status === "declined" || request.status === "canceled") return { ok: true, done: true };

  await declineSignatureRequest(ctx.scope, request, reason.trim().slice(0, 500) || null, "portal", await clientIp());
  return { ok: true, done: true };
}
