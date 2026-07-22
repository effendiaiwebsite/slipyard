import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OrgScope } from "@/db/scoped";
import type { schema } from "@/db";
import { env } from "@/lib/env";
import { portalTokenProblem, type PortalTokenRow } from "@/lib/portal-tokens";

/**
 * Portal session (M4): after the OTP is verified, a short-lived signed
 * cookie carries {token id, org_id, client_id}; every portal request
 * re-loads the portal_token row, so staff revocation kills live sessions
 * within one navigation. 30-minute absolute lifetime — long enough for a
 * slow, careful upload session, short enough for a shared family tablet.
 *
 * The org id in the cookie is trusted the same way the magic link's is:
 * the signature (AUTH_SECRET) is the credential.
 */

export const PORTAL_SESSION_COOKIE = "portal_session";
export const PORTAL_SESSION_TTL_MS = 30 * 60 * 1000;

const SESSION_ISSUER = "accountant-crm-portal-session";

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

type ClientRow = typeof schema.client.$inferSelect;

export type PortalContext = {
  orgId: string;
  tokenId: string;
  /** The client the link was issued for. */
  client: ClientRow;
  /** That client plus household members when the token includes them. */
  clients: ClientRow[];
  scopes: string[];
  recipientName: string;
  isHelper: boolean;
  token: PortalTokenRow;
  /** OrgScope with a null user — audit entries use actorType 'client'. */
  scope: OrgScope;
};

/** Set after successful OTP verification. */
export async function createPortalSession(token: PortalTokenRow): Promise<void> {
  const jwt = await new SignJWT({ org_id: token.orgId, client_id: token.clientId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(token.id)
    .setIssuer(SESSION_ISSUER)
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + PORTAL_SESSION_TTL_MS))
    .sign(jwtSecret());

  const jar = await cookies();
  jar.set(PORTAL_SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    path: "/",
    maxAge: PORTAL_SESSION_TTL_MS / 1000,
  });
}

export async function clearPortalSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(PORTAL_SESSION_COOKIE);
}

/**
 * Resolve the current portal session, or null. Shared by the page gate
 * (redirects) and the API gate (JSON errors).
 */
export async function getPortalContext(): Promise<PortalContext | null> {
  const jar = await cookies();
  const raw = jar.get(PORTAL_SESSION_COOKIE)?.value;
  if (!raw) return null;

  let orgId: string, tokenId: string;
  try {
    const { payload } = await jwtVerify(raw, jwtSecret(), { issuer: SESSION_ISSUER });
    if (typeof payload.org_id !== "string" || typeof payload.sub !== "string") return null;
    orgId = payload.org_id;
    tokenId = payload.sub;
  } catch {
    return null;
  }

  const scope = new OrgScope(orgId, null);
  const token = await scope.getPortalToken(tokenId);
  // Sessions require a VERIFIED token; the opened-window rule applies to the
  // link URL, not the session, so only check revocation + hard expiry + lock.
  if (!token || !token.verifiedAt) return null;
  if (token.revokedAt) return null;
  const problem = portalTokenProblem(token);
  if (problem === "locked") return null;

  const client = await scope.getClient(token.clientId);
  if (!client || client.status !== "active") return null;

  let clients: ClientRow[] = [client];
  if (token.includeHousehold && client.householdId) {
    const members = await scope.listHouseholdClients(client.householdId);
    if (members.length > 0) clients = members;
    // The primary client is always present even if archived-household edge
    // cases filter it out above.
    if (!clients.some((c) => c.id === client.id)) clients = [client, ...clients];
  }

  return {
    orgId,
    tokenId,
    client,
    clients,
    scopes: token.scopes,
    recipientName: token.recipientName,
    isHelper: token.isHelper,
    token,
    scope,
  };
}

/** Page gate: valid session or back to the portal landing explainer. */
export async function requirePortal(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/portal?reason=session");
  return ctx;
}
