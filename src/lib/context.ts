import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgScope, listMembershipsForUser } from "@/db/scoped";
import { auth } from "@/lib/auth";
import type { Actor, Role } from "@/lib/permissions";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type StaffContext = {
  user: { id: string; name: string; email: string };
  actor: Actor;
  role: Role;
  orgId: string;
  orgName: string;
  scope: OrgScope;
};

/**
 * The staff-app gate. Every /app page/handler obtains its context here —
 * this is the only place an OrgScope is minted from a session, so org_id can
 * never come from user input.
 *
 * Enforces, in order: valid session → mandatory TOTP → 30-min idle timeout
 * (absolute 12 h lifetime is better-auth's expiresIn) → active org membership.
 */
export async function requireStaff(): Promise<StaffContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  // Mandatory 2FA: no staff surface renders until TOTP is enrolled.
  if (!session.user.twoFactorEnabled) redirect("/setup-mfa");

  // Idle timeout: updatedAt tracks last activity (session.updateAge = 5 min).
  const lastActivity = new Date(session.session.updatedAt).getTime();
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS + 5 * 60 * 1000) {
    redirect("/login?reason=idle");
  }

  const memberships = await listMembershipsForUser(session.user.id);
  if (memberships.length === 0) redirect("/no-organization");

  // Single-org users (the norm) get their org; multi-org selection is an M1
  // concern (active-org cookie) — until then, first membership wins.
  const m = memberships[0];

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    actor: { userId: session.user.id, orgId: m.org.id, role: m.membership.role },
    role: m.membership.role,
    orgId: m.org.id,
    orgName: m.org.name,
    scope: new OrgScope(m.org.id, session.user.id),
  };
}

/** Session-only gate for pre-org pages (setup-mfa, no-organization). */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}
