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

  // ---- invitations -------------------------------------------------------------

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
        org: { id: schema.org.id, name: schema.org.name },
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
