import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgScope, listMembershipsForUser } from "@/db/scoped";
import type { OrgSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Actor, Role } from "@/lib/permissions";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type StaffContext = {
  user: { id: string; name: string; email: string };
  actor: Actor;
  role: Role;
  orgId: string;
  orgName: string;
  timezone: string;
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  orgSettings: OrgSettings;
  /** Lapsed subscription or expired unsubscribed trial ⇒ writes blocked (grace mode). */
  readOnly: boolean;
  scope: OrgScope;
};

export function computeReadOnly(org: {
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | null;
  stripeSubscriptionId: string | null;
}): boolean {
  if (org.subscriptionStatus === "past_due" || org.subscriptionStatus === "canceled") return true;
  if (
    org.subscriptionStatus === "trialing" &&
    !org.stripeSubscriptionId &&
    org.trialEndsAt !== null &&
    org.trialEndsAt.getTime() < Date.now()
  ) {
    // App-level trial ran out and the owner never completed Checkout.
    return true;
  }
  return false;
}

/**
 * The staff-app gate. Every /app page/handler obtains its context here —
 * this is the only place an OrgScope is minted from a session, so org_id can
 * never come from user input.
 *
 * Enforces, in order: valid session → mandatory TOTP → 30-min idle timeout
 * (absolute 12 h lifetime is better-auth's expiresIn) → active org membership.
 * Grace mode (readOnly) is surfaced here and enforced by authorize().
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

  // Single-org users (the norm) get their org; multi-org selection is a
  // later concern (active-org cookie) — until then, first membership wins.
  const m = memberships[0];

  return buildStaffContext(session, m);
}

/**
 * Route-handler variant of requireStaff (M3 upload route): same gates, but
 * failures come back as JSON-able errors instead of redirects — a fetch()
 * caller can't follow a redirect to a login page.
 */
export async function staffApiContext(): Promise<
  { ok: true; ctx: StaffContext } | { ok: false; error: string; status: number }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not signed in.", status: 401 };
  if (!session.user.twoFactorEnabled)
    return { ok: false, error: "Two-factor enrollment required.", status: 403 };
  const lastActivity = new Date(session.session.updatedAt).getTime();
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS + 5 * 60 * 1000) {
    return { ok: false, error: "Session timed out — sign in again.", status: 401 };
  }
  const memberships = await listMembershipsForUser(session.user.id);
  if (memberships.length === 0)
    return { ok: false, error: "No organization membership.", status: 403 };
  return { ok: true, ctx: buildStaffContext(session, memberships[0]) };
}

function buildStaffContext(
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>,
  m: Awaited<ReturnType<typeof listMembershipsForUser>>[number]
): StaffContext {
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    actor: { userId: session.user.id, orgId: m.org.id, role: m.membership.role },
    role: m.membership.role,
    orgId: m.org.id,
    orgName: m.org.name,
    timezone: m.org.timezone,
    subscriptionStatus: m.org.subscriptionStatus,
    trialEndsAt: m.org.trialEndsAt,
    stripeCustomerId: m.org.stripeCustomerId,
    stripeSubscriptionId: m.org.stripeSubscriptionId,
    orgSettings: m.org.settings,
    readOnly: computeReadOnly(m.org),
    scope: new OrgScope(m.org.id, session.user.id),
  };
}

/** Session-only gate for pre-org pages (setup-mfa, no-organization). */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}
