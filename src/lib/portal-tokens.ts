import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { OrgScope } from "@/db/scoped";
import type { schema } from "@/db";
import { env } from "@/lib/env";
import { sendSms } from "@/lib/messaging";

/**
 * Portal magic-link tokens (M4). The link carries a signed JWT that embeds
 * org_id + client_id + scopes (iron rule: tokens embed AND validate org_id);
 * the DB stores only the sha256 of the raw token (ADR-0003) plus the OTP
 * challenge state. Validation order matters:
 *
 *   1. verify the JWT signature (AUTH_SECRET) — this alone authenticates the
 *      org_id claim, so we can arm RLS from it,
 *   2. look the row up BY HASH inside that org's scope,
 *   3. cross-check row.id / row.client_id against the claims,
 *   4. apply lifecycle rules: revoked → expired (7 d unopened) → opened
 *      window (15 min) → OTP attempts (max 5, durable in the row).
 *
 * The 6-digit SMS OTP goes to the RECIPIENT's phone (client or trusted
 * helper). After a correct code the portal session cookie
 * (src/lib/portal-context.ts) takes over; the link itself stays subject to
 * the 15-minute opened window.
 */

export type PortalTokenRow = typeof schema.portalToken.$inferSelect;

export const PORTAL_LINK_UNOPENED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PORTAL_LINK_OPENED_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PORTAL_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PORTAL_OTP_MAX_ATTEMPTS = 5;

const JWT_ISSUER = "accountant-crm-portal";

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

/** sha256 of the raw magic-link token — only the hash is stored (ADR-0003). */
export function hashPortalToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** OTP codes are hashed with the token id as context — never stored raw. */
function hashOtp(code: string, tokenId: string): string {
  return createHash("sha256").update(`${code}:${tokenId}`).digest("hex");
}

export type MintPortalLinkInput = {
  clientId: string;
  recipientName: string;
  recipientPhone: string;
  isHelper?: boolean;
  helperRelationship?: string | null;
  includeHousehold?: boolean;
  scopes?: string[];
  createdBy: string;
};

/**
 * Mint a magic link: JWT first (it embeds the pre-generated row id as `sub`),
 * then the row keyed by the JWT's hash. Returns the raw URL for the outbox
 * message — the raw token is never stored or logged.
 */
export async function mintPortalLink(
  scope: OrgScope,
  input: MintPortalLinkInput
): Promise<{ url: string; token: PortalTokenRow }> {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PORTAL_LINK_UNOPENED_TTL_MS);
  const scopes = input.scopes ?? ["view", "upload"];

  const raw = await new SignJWT({
    org_id: scope.orgId,
    client_id: input.clientId,
    scopes,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(tokenId)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(jwtSecret());

  const token = await scope.createPortalToken({
    id: tokenId,
    clientId: input.clientId,
    tokenHash: hashPortalToken(raw),
    recipientName: input.recipientName,
    recipientPhone: input.recipientPhone,
    isHelper: input.isHelper ?? false,
    helperRelationship: input.helperRelationship ?? null,
    includeHousehold: input.includeHousehold ?? false,
    scopes,
    expiresAt,
    createdBy: input.createdBy,
  });

  return { url: `${env.APP_URL}/portal/${raw}`, token };
}

export type PortalTokenProblem =
  | "invalid" // bad signature, unknown hash, claim mismatch
  | "revoked"
  | "expired" // 7-day TTL passed, or 15-minute opened window passed
  | "locked"; // too many wrong OTP entries

export type ValidatedPortalToken = {
  token: PortalTokenRow;
  scope: OrgScope;
};

/**
 * Validate a raw magic-link token from a URL. Returns the row + an OrgScope
 * armed with the verified org claim, or a coarse problem code (details never
 * leak to the anonymous caller).
 */
export async function validatePortalLink(
  raw: string
): Promise<{ ok: true; value: ValidatedPortalToken } | { ok: false; problem: PortalTokenProblem }> {
  let claims: { orgId: string; clientId: string; tokenId: string };
  try {
    const { payload } = await jwtVerify(raw, jwtSecret(), { issuer: JWT_ISSUER });
    if (
      typeof payload.org_id !== "string" ||
      typeof payload.client_id !== "string" ||
      typeof payload.sub !== "string"
    ) {
      return { ok: false, problem: "invalid" };
    }
    claims = { orgId: payload.org_id, clientId: payload.client_id, tokenId: payload.sub };
  } catch {
    // Bad signature or past the JWT exp (== row expires_at for unopened links).
    return { ok: false, problem: "invalid" };
  }

  // The verified signature authenticates org_id — safe to arm RLS with it.
  const scope = new OrgScope(claims.orgId, null);
  const token = await scope.getPortalTokenByHash(hashPortalToken(raw));
  if (!token || token.id !== claims.tokenId || token.clientId !== claims.clientId) {
    return { ok: false, problem: "invalid" };
  }

  const problem = portalTokenProblem(token);
  if (problem) return { ok: false, problem };
  return { ok: true, value: { token, scope } };
}

/** Lifecycle check shared by the link page and the session layer. */
export function portalTokenProblem(token: PortalTokenRow): PortalTokenProblem | null {
  const now = Date.now();
  if (token.revokedAt) return "revoked";
  if (token.expiresAt.getTime() < now) return "expired";
  if (token.otpAttempts >= PORTAL_OTP_MAX_ATTEMPTS) return "locked";
  if (token.openedAt && now > token.openedAt.getTime() + PORTAL_LINK_OPENED_TTL_MS) {
    return "expired";
  }
  return null;
}

/**
 * First open stamps opened_at (starting the 15-minute window) and triggers
 * the OTP send. Re-opens inside the window reuse the outstanding code.
 */
export async function markOpenedAndSendOtp(
  scope: OrgScope,
  token: PortalTokenRow
): Promise<PortalTokenRow> {
  let current = token;
  if (!current.openedAt) {
    current = (await scope.updatePortalToken(current.id, { openedAt: new Date() })) ?? current;
    await scope.writeAudit({
      actorType: "client",
      action: "portal.link_opened",
      resourceType: "portal_token",
      resourceId: current.id,
    });
  }
  const otpLive =
    current.otpHash && current.otpExpiresAt && current.otpExpiresAt.getTime() > Date.now();
  if (!otpLive) {
    current = await issueOtp(scope, current);
  }
  return current;
}

/** Generate + SMS a fresh 6-digit code (outbox in dev). */
export async function issueOtp(scope: OrgScope, token: PortalTokenRow): Promise<PortalTokenRow> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const updated =
    (await scope.updatePortalToken(token.id, {
      otpHash: hashOtp(code, token.id),
      otpExpiresAt: new Date(Date.now() + PORTAL_OTP_TTL_MS),
    })) ?? token;

  await sendSms(scope, {
    to: token.recipientPhone,
    body: `${code} is your security code for your accountant's portal. It expires in 10 minutes. Never share this code.`,
    meta: { kind: "portal_otp", portalTokenId: token.id },
  });
  await scope.writeAudit({
    actorType: "system",
    action: "portal.otp_sent",
    resourceType: "portal_token",
    resourceId: token.id,
  });
  return updated;
}

export type OtpVerifyResult =
  | { ok: true; token: PortalTokenRow }
  | { ok: false; problem: "wrong_code" | "expired_code" | PortalTokenProblem };

/**
 * Check a submitted code. Wrong entries increment the durable attempt
 * counter FIRST (atomically), so 5 wrong guesses always kill the link even
 * under concurrent submissions.
 */
export async function verifyOtp(
  scope: OrgScope,
  token: PortalTokenRow,
  submitted: string
): Promise<OtpVerifyResult> {
  const lifecycle = portalTokenProblem(token);
  if (lifecycle) return { ok: false, problem: lifecycle };
  if (!token.otpHash || !token.otpExpiresAt || token.otpExpiresAt.getTime() < Date.now()) {
    return { ok: false, problem: "expired_code" };
  }

  const expected = Buffer.from(token.otpHash, "hex");
  const actual = Buffer.from(hashOtp(submitted.trim(), token.id), "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    const attempts = await scope.incrementPortalOtpAttempts(token.id);
    await scope.writeAudit({
      actorType: "client",
      action: "portal.otp_failed",
      resourceType: "portal_token",
      resourceId: token.id,
      details: { attempts },
    });
    return {
      ok: false,
      problem: attempts >= PORTAL_OTP_MAX_ATTEMPTS ? "locked" : "wrong_code",
    };
  }

  const updated =
    (await scope.updatePortalToken(token.id, {
      verifiedAt: new Date(),
      otpHash: null,
      otpExpiresAt: null,
    })) ?? token;
  await scope.writeAudit({
    actorType: "client",
    action: "portal.otp_verified",
    resourceType: "portal_token",
    resourceId: token.id,
  });
  return { ok: true, token: updated };
}
