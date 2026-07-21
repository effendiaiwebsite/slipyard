import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from ".";

/**
 * Org-scoped repository layer — the ONLY sanctioned path to tenant data.
 *
 * Every operation runs inside a transaction that first calls
 *   set_config('app.org_id', <orgId>, true)   -- transaction-local
 *   set_config('app.user_id', <userId>, true)
 * which arms the FORCE ROW LEVEL SECURITY policies, and every query ALSO
 * filters by org_id explicitly. Either layer alone would be sufficient;
 * together a bug in one is caught by the other.
 *
 * Handlers obtain an OrgScope via requireStaff() (src/lib/context.ts) — never
 * construct one from user-supplied org ids.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class OrgScope {
  constructor(
    readonly orgId: string,
    /** Acting staff user id, or null for system jobs. */
    readonly userId: string | null
  ) {}

  /** Run `fn` in a transaction with tenant GUCs set. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${this.orgId}, true), set_config('app.user_id', ${this.userId ?? ""}, true)`
      );
      return fn(tx);
    });
  }

  // ---- org -----------------------------------------------------------------

  async getOrg() {
    return this.tx(async (tx) => {
      const rows = await tx.select().from(schema.org).where(eq(schema.org.id, this.orgId));
      return rows[0] ?? null;
    });
  }

  async updateOrgSettings(settings: Partial<schema.OrgSettings>) {
    return this.tx(async (tx) => {
      const current = (
        await tx.select().from(schema.org).where(eq(schema.org.id, this.orgId))
      )[0];
      if (!current) throw new Error("Org not found in scope");
      const merged = { ...current.settings, ...settings };
      await tx
        .update(schema.org)
        .set({ settings: merged, updatedAt: new Date() })
        .where(eq(schema.org.id, this.orgId));
      return merged;
    });
  }

  // ---- memberships -----------------------------------------------------------

  async listMemberships() {
    return this.tx((tx) =>
      tx
        .select({
          membership: schema.orgMembership,
          user: {
            id: schema.staffUser.id,
            name: schema.staffUser.name,
            email: schema.staffUser.email,
          },
        })
        .from(schema.orgMembership)
        .innerJoin(schema.staffUser, eq(schema.orgMembership.userId, schema.staffUser.id))
        .where(eq(schema.orgMembership.orgId, this.orgId))
        .orderBy(schema.orgMembership.createdAt)
    );
  }

  async getMembership(userId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.orgMembership)
        .where(
          and(
            eq(schema.orgMembership.orgId, this.orgId),
            eq(schema.orgMembership.userId, userId)
          )
        );
      return rows[0] ?? null;
    });
  }

  async updateOrgProfile(fields: { name?: string; timezone?: string }) {
    return this.tx((tx) =>
      tx
        .update(schema.org)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.org.id, this.orgId))
    );
  }

  async getMembershipById(membershipId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.orgMembership)
        .where(
          and(
            eq(schema.orgMembership.orgId, this.orgId),
            eq(schema.orgMembership.id, membershipId)
          )
        );
      return rows[0] ?? null;
    });
  }

  async updateMembership(
    membershipId: string,
    fields: Partial<{ role: "owner" | "admin" | "accountant" | "clerk"; status: "active" | "deactivated" }>
  ) {
    return this.tx((tx) =>
      tx
        .update(schema.orgMembership)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(schema.orgMembership.orgId, this.orgId),
            eq(schema.orgMembership.id, membershipId)
          )
        )
    );
  }

  async countActiveOwners(): Promise<number> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({ id: schema.orgMembership.id })
        .from(schema.orgMembership)
        .where(
          and(
            eq(schema.orgMembership.orgId, this.orgId),
            eq(schema.orgMembership.role, "owner"),
            eq(schema.orgMembership.status, "active")
          )
        );
      return rows.length;
    });
  }

  // ---- outbox -----------------------------------------------------------------

  async createOutbox(entry: {
    channel: "email" | "sms";
    toAddress: string;
    subject?: string;
    body: string;
    provider: string;
    status?: "queued" | "sent" | "failed";
    meta?: Record<string, unknown>;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.outbox)
        .values({
          orgId: this.orgId,
          channel: entry.channel,
          toAddress: entry.toAddress,
          subject: entry.subject,
          body: entry.body,
          provider: entry.provider,
          status: entry.status ?? "queued",
          sentAt: entry.status === "sent" ? new Date() : null,
          meta: entry.meta,
        })
        .returning();
      return rows[0];
    });
  }

  async listOutbox(limit = 50) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.orgId, this.orgId))
        .orderBy(desc(schema.outbox.createdAt))
        .limit(limit)
    );
  }

  // ---- invitations -------------------------------------------------------------

  async createInvitation(inv: {
    email: string;
    phone: string | null;
    name: string;
    role: "owner" | "admin" | "accountant" | "clerk";
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.invitation)
        .values({ orgId: this.orgId, ...inv })
        .returning();
      return rows[0];
    });
  }

  async revokeInvitation(invitationId: string) {
    return this.tx((tx) =>
      tx
        .update(schema.invitation)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.invitation.orgId, this.orgId), eq(schema.invitation.id, invitationId))
        )
    );
  }

  async listInvitations() {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.invitation)
        .where(and(eq(schema.invitation.orgId, this.orgId), isNull(schema.invitation.revokedAt)))
        .orderBy(desc(schema.invitation.createdAt))
    );
  }

  // ---- audit log -----------------------------------------------------------------

  async writeAudit(entry: {
    actorType: "staff" | "client" | "system" | "ai";
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ip?: string;
  }) {
    return this.tx((tx) =>
      tx.insert(schema.auditLog).values({
        orgId: this.orgId,
        actorType: entry.actorType,
        actorUserId: this.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        details: entry.details,
        ip: entry.ip,
      })
    );
  }

  async listAudit(limit = 100) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.orgId, this.orgId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit)
    );
  }
}

/**
 * Org creation bootstrap (M1 signup). The org UUID is pre-generated and set
 * as the transaction's app.org_id BEFORE the insert, so FORCEd RLS WITH
 * CHECK passes without any bypass: the new org, the owner membership, and
 * the audit entry all fall inside the just-armed tenant scope.
 */
export async function createOrgForUser(
  userId: string,
  name: string,
  timezone: string
): Promise<string> {
  const orgId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true)`
    );
    await tx.insert(schema.org).values({
      id: orgId,
      name,
      timezone,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    await tx.insert(schema.orgMembership).values({ orgId, userId, role: "owner" });
    await tx.insert(schema.auditLog).values({
      orgId,
      actorType: "staff",
      actorUserId: userId,
      action: "org.create",
      resourceType: "org",
      resourceId: orgId,
    });
  });
  return orgId;
}

/**
 * Invitation lookup for the join flow (no org context yet). RLS policy
 * `invitation_by_token` exposes exactly the row whose token hash matches the
 * GUC — possession of the raw token is the credential.
 */
export async function findInvitationByTokenHash(tokenHash: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.invite_token_hash', ${tokenHash}, true)`);
    const rows = await tx
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.tokenHash, tokenHash));
    const inv = rows[0];
    if (!inv) return null;
    // Two-step on purpose: the org row is invisible until we arm app.org_id,
    // and holding a valid token legitimately entitles the caller to the org
    // name. A join before set_config would silently return nothing.
    await tx.execute(sql`select set_config('app.org_id', ${inv.orgId}, true)`);
    const orgs = await tx
      .select({ name: schema.org.name })
      .from(schema.org)
      .where(eq(schema.org.id, inv.orgId));
    return { invitation: inv, orgName: orgs[0]?.name ?? "your firm" };
  });
}

/**
 * Accept an invitation: membership + accepted stamp + audit, one transaction
 * under the invite's org scope (org id comes from the validated invite row,
 * never from the client).
 */
export async function acceptInvitation(inviteId: string, orgId: string, tokenHash: string, userId: string, role: "owner" | "admin" | "accountant" | "clerk", invitedBy: string) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true), set_config('app.invite_token_hash', ${tokenHash}, true)`
    );
    await tx.insert(schema.orgMembership).values({ orgId, userId, role, invitedBy });
    await tx
      .update(schema.invitation)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitation.id, inviteId));
    await tx.insert(schema.auditLog).values({
      orgId,
      actorType: "staff",
      actorUserId: userId,
      action: "invitation.accept",
      resourceType: "invitation",
      resourceId: inviteId,
    });
  });
}

/**
 * Webhook-path helpers (system actor, no user session). Org identity comes
 * exclusively from signature-verified Stripe payloads.
 */
export async function findOrgByStripeCustomer(customerId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.stripe_customer_id', ${customerId}, true)`);
    const rows = await tx
      .select()
      .from(schema.org)
      .where(eq(schema.org.stripeCustomerId, customerId));
    return rows[0] ?? null;
  });
}

export async function updateOrgBillingState(
  orgId: string,
  fields: Partial<{
    subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
  }>,
  source: string
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx
      .update(schema.org)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(schema.org.id, orgId));
    await tx.insert(schema.auditLog).values({
      orgId,
      actorType: "system",
      action: "billing.sync",
      resourceType: "org",
      resourceId: orgId,
      details: { source, ...fields },
    });
  });
}

/** Webhook idempotency: true if this event id is new (caller should process). */
export async function recordStripeEventOnce(eventId: string, type: string): Promise<boolean> {
  const res = await db
    .insert(schema.stripeEvent)
    .values({ id: eventId, type })
    .onConflictDoNothing();
  return (res.rowCount ?? 0) > 0;
}

/**
 * Membership lookup that runs BEFORE an org context exists (login flow).
 * RLS on org_membership has a second policy allowing rows where
 * user_id = current_setting('app.user_id'), which this arms.
 */
export async function listMembershipsForUser(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return tx
      .select({
        membership: schema.orgMembership,
        org: {
          id: schema.org.id,
          name: schema.org.name,
          timezone: schema.org.timezone,
          subscriptionStatus: schema.org.subscriptionStatus,
          trialEndsAt: schema.org.trialEndsAt,
          stripeCustomerId: schema.org.stripeCustomerId,
          stripeSubscriptionId: schema.org.stripeSubscriptionId,
          settings: schema.org.settings,
        },
      })
      .from(schema.orgMembership)
      .innerJoin(schema.org, eq(schema.orgMembership.orgId, schema.org.id))
      .where(
        and(
          eq(schema.orgMembership.userId, userId),
          eq(schema.orgMembership.status, "active")
        )
      );
  });
}
