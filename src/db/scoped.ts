import { and, asc, desc, eq, ilike, isNull, max, ne, sql } from "drizzle-orm";
import { db, schema } from ".";
import { DEFAULT_ENGAGEMENT_STAGES, type StageCategory } from "./schema";

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

  // ---- clients (M2) ----------------------------------------------------------

  /**
   * Grid query: clients with assignee/household names, their latest
   * engagement, and last contact. Small-firm scale (hundreds of clients) —
   * three simple queries merged in JS beat one lateral-join monster.
   */
  async listClientsWithMeta(opts?: {
    q?: string;
    type?: "individual" | "corporation" | "trust";
    status?: "active" | "archived";
    /** Restrict to one assignee (accountant assigned_only mode / "mine"). */
    assignedToId?: string;
  }) {
    return this.tx(async (tx) => {
      const conds = [eq(schema.client.orgId, this.orgId)];
      if (opts?.q) conds.push(ilike(schema.client.displayName, `%${opts.q}%`));
      if (opts?.type) conds.push(eq(schema.client.type, opts.type));
      if (opts?.status) conds.push(eq(schema.client.status, opts.status));
      if (opts?.assignedToId)
        conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));

      const clients = await tx
        .select({
          client: schema.client,
          assignedName: schema.staffUser.name,
          householdName: schema.household.name,
        })
        .from(schema.client)
        .leftJoin(schema.staffUser, eq(schema.client.assignedAccountantId, schema.staffUser.id))
        .leftJoin(schema.household, eq(schema.client.householdId, schema.household.id))
        .where(and(...conds))
        .orderBy(schema.client.displayName);

      const engagements = await tx
        .select({ engagement: schema.engagement, stage: schema.engagementStage })
        .from(schema.engagement)
        .innerJoin(
          schema.engagementStage,
          eq(schema.engagement.stageId, schema.engagementStage.id)
        )
        .where(eq(schema.engagement.orgId, this.orgId))
        .orderBy(desc(schema.engagement.taxYear), desc(schema.engagement.createdAt));

      const lastContacts = await tx
        .select({
          clientId: schema.contactLog.clientId,
          last: max(schema.contactLog.occurredAt),
        })
        .from(schema.contactLog)
        .where(eq(schema.contactLog.orgId, this.orgId))
        .groupBy(schema.contactLog.clientId);

      // First row per client is the latest engagement (ordered above).
      const latestByClient = new Map<string, (typeof engagements)[number]>();
      for (const e of engagements)
        if (!latestByClient.has(e.engagement.clientId))
          latestByClient.set(e.engagement.clientId, e);
      const lastByClient = new Map(lastContacts.map((r) => [r.clientId, r.last]));

      return clients.map((row) => ({
        ...row,
        latestEngagement: latestByClient.get(row.client.id) ?? null,
        lastContactAt: lastByClient.get(row.client.id) ?? null,
      }));
    });
  }

  /** Light fetch — permission checks need assignedAccountantId before acting. */
  async getClient(clientId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.client)
        .where(and(eq(schema.client.orgId, this.orgId), eq(schema.client.id, clientId)));
      return rows[0] ?? null;
    });
  }

  async getClientDetail(clientId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          client: schema.client,
          assignedName: schema.staffUser.name,
          householdName: schema.household.name,
        })
        .from(schema.client)
        .leftJoin(schema.staffUser, eq(schema.client.assignedAccountantId, schema.staffUser.id))
        .leftJoin(schema.household, eq(schema.client.householdId, schema.household.id))
        .where(and(eq(schema.client.orgId, this.orgId), eq(schema.client.id, clientId)));
      const found = rows[0];
      if (!found) return null;

      const householdMembers = found.client.householdId
        ? await tx
            .select({ id: schema.client.id, displayName: schema.client.displayName })
            .from(schema.client)
            .where(
              and(
                eq(schema.client.orgId, this.orgId),
                eq(schema.client.householdId, found.client.householdId),
                ne(schema.client.id, clientId)
              )
            )
        : [];

      const notes = await tx
        .select({ note: schema.clientNote, authorName: schema.staffUser.name })
        .from(schema.clientNote)
        .leftJoin(schema.staffUser, eq(schema.clientNote.authorId, schema.staffUser.id))
        .where(
          and(eq(schema.clientNote.orgId, this.orgId), eq(schema.clientNote.clientId, clientId))
        )
        .orderBy(desc(schema.clientNote.pinned), desc(schema.clientNote.createdAt));

      const contacts = await tx
        .select({ entry: schema.contactLog, byName: schema.staffUser.name })
        .from(schema.contactLog)
        .leftJoin(schema.staffUser, eq(schema.contactLog.createdBy, schema.staffUser.id))
        .where(
          and(eq(schema.contactLog.orgId, this.orgId), eq(schema.contactLog.clientId, clientId))
        )
        .orderBy(desc(schema.contactLog.occurredAt))
        .limit(50);

      const engagements = await tx
        .select({
          engagement: schema.engagement,
          assignedName: schema.staffUser.name,
          stage: schema.engagementStage,
        })
        .from(schema.engagement)
        .innerJoin(
          schema.engagementStage,
          eq(schema.engagement.stageId, schema.engagementStage.id)
        )
        .leftJoin(schema.staffUser, eq(schema.engagement.assignedToId, schema.staffUser.id))
        .where(
          and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.clientId, clientId))
        )
        .orderBy(desc(schema.engagement.taxYear), desc(schema.engagement.createdAt));

      return { ...found, householdMembers, notes, contacts, engagements };
    });
  }

  async createClient(fields: Omit<typeof schema.client.$inferInsert, "id" | "orgId">) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.client)
        .values({ ...fields, orgId: this.orgId })
        .returning();
      return rows[0];
    });
  }

  async updateClient(
    clientId: string,
    fields: Partial<Omit<typeof schema.client.$inferInsert, "id" | "orgId">>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.client)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(schema.client.orgId, this.orgId), eq(schema.client.id, clientId)))
        .returning();
      return rows[0] ?? null;
    });
  }

  // ---- households ------------------------------------------------------------

  async listHouseholds() {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.household)
        .where(eq(schema.household.orgId, this.orgId))
        .orderBy(schema.household.name)
    );
  }

  async createHousehold(name: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.household)
        .values({ orgId: this.orgId, name })
        .returning();
      return rows[0];
    });
  }

  // ---- notes & contact log ---------------------------------------------------

  async addClientNote(note: { clientId: string; body: string; pinned?: boolean }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.clientNote)
        .values({ orgId: this.orgId, authorId: this.userId, ...note })
        .returning();
      return rows[0];
    });
  }

  async setNotePinned(noteId: string, pinned: boolean) {
    return this.tx((tx) =>
      tx
        .update(schema.clientNote)
        .set({ pinned, updatedAt: new Date() })
        .where(and(eq(schema.clientNote.orgId, this.orgId), eq(schema.clientNote.id, noteId)))
    );
  }

  async addContactLog(entry: {
    clientId: string;
    channel: "phone" | "email" | "sms" | "meeting" | "mail" | "other";
    summary: string;
    occurredAt?: Date;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.contactLog)
        .values({ orgId: this.orgId, createdBy: this.userId, ...entry })
        .returning();
      return rows[0];
    });
  }

  // ---- workflow stages (per-org, ADR-0015) -----------------------------------

  async listStages() {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.engagementStage)
        .where(eq(schema.engagementStage.orgId, this.orgId))
        .orderBy(asc(schema.engagementStage.position))
    );
  }

  async getStage(stageId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.engagementStage)
        .where(
          and(eq(schema.engagementStage.orgId, this.orgId), eq(schema.engagementStage.id, stageId))
        );
      return rows[0] ?? null;
    });
  }

  /** Appends at the end; key must be unique within the org (caller slugifies). */
  async createStage(fields: { key: string; label: string; category: StageCategory }) {
    return this.tx(async (tx) => {
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<number>`coalesce(max(position), -1)::int` })
        .from(schema.engagementStage)
        .where(eq(schema.engagementStage.orgId, this.orgId));
      const rows = await tx
        .insert(schema.engagementStage)
        .values({ orgId: this.orgId, position: maxPos + 1, ...fields })
        .returning();
      return rows[0];
    });
  }

  async updateStage(stageId: string, fields: Partial<{ label: string; category: StageCategory }>) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.engagementStage)
        .set(fields)
        .where(
          and(eq(schema.engagementStage.orgId, this.orgId), eq(schema.engagementStage.id, stageId))
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  /** Rewrites position = index for the given full ordering. */
  async setStagePositions(orderedIds: string[]) {
    return this.tx(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(schema.engagementStage)
          .set({ position: i })
          .where(
            and(
              eq(schema.engagementStage.orgId, this.orgId),
              eq(schema.engagementStage.id, orderedIds[i])
            )
          );
      }
    });
  }

  /**
   * Delete a stage, first moving its engagements to `reassignToId` (same
   * org). Returns 'in_use' if engagements reference it and no target was
   * given — callers turn that into a friendly message.
   */
  async deleteStage(stageId: string, reassignToId?: string): Promise<"ok" | "in_use" | "not_found"> {
    return this.tx(async (tx) => {
      const stages = await tx
        .select()
        .from(schema.engagementStage)
        .where(
          and(eq(schema.engagementStage.orgId, this.orgId), eq(schema.engagementStage.id, stageId))
        );
      if (!stages[0]) return "not_found";
      const [{ inUse }] = await tx
        .select({ inUse: sql<number>`count(*)::int` })
        .from(schema.engagement)
        .where(and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.stageId, stageId)));
      if (inUse > 0) {
        if (!reassignToId) return "in_use";
        await tx
          .update(schema.engagement)
          .set({ stageId: reassignToId, updatedAt: new Date() })
          .where(
            and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.stageId, stageId))
          );
      }
      await tx
        .delete(schema.engagementStage)
        .where(
          and(eq(schema.engagementStage.orgId, this.orgId), eq(schema.engagementStage.id, stageId))
        );
      return "ok";
    });
  }

  // ---- engagements -----------------------------------------------------------

  async listEngagementsWithMeta(opts?: { assignedToId?: string; taxYear?: number }) {
    return this.tx((tx) => {
      const conds = [eq(schema.engagement.orgId, this.orgId)];
      if (opts?.assignedToId) conds.push(eq(schema.engagement.assignedToId, opts.assignedToId));
      if (opts?.taxYear) conds.push(eq(schema.engagement.taxYear, opts.taxYear));
      return tx
        .select({
          engagement: schema.engagement,
          clientName: schema.client.displayName,
          clientType: schema.client.type,
          assignedName: schema.staffUser.name,
          stage: schema.engagementStage,
        })
        .from(schema.engagement)
        .innerJoin(schema.client, eq(schema.engagement.clientId, schema.client.id))
        .innerJoin(
          schema.engagementStage,
          eq(schema.engagement.stageId, schema.engagementStage.id)
        )
        .leftJoin(schema.staffUser, eq(schema.engagement.assignedToId, schema.staffUser.id))
        .where(and(...conds))
        .orderBy(desc(schema.engagement.updatedAt));
    });
  }

  async getEngagement(engagementId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.engagement)
        .where(
          and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.id, engagementId))
        );
      return rows[0] ?? null;
    });
  }

  async createEngagement(fields: {
    clientId: string;
    type: "t1" | "t2" | "t3" | "other";
    taxYear: number;
    stageId: string;
    assignedToId?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.engagement)
        .values({ orgId: this.orgId, createdBy: this.userId, ...fields })
        .returning();
      return rows[0];
    });
  }

  /** Move to a stage + stamp the moment it was entered (statusTimestamps[stage.key]). */
  async transitionEngagement(engagementId: string, stageId: string) {
    return this.tx(async (tx) => {
      const stages = await tx
        .select()
        .from(schema.engagementStage)
        .where(
          and(eq(schema.engagementStage.orgId, this.orgId), eq(schema.engagementStage.id, stageId))
        );
      const stage = stages[0];
      if (!stage) return null;
      const rows = await tx
        .select()
        .from(schema.engagement)
        .where(
          and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.id, engagementId))
        );
      const current = rows[0];
      if (!current) return null;
      const updated = await tx
        .update(schema.engagement)
        .set({
          stageId,
          statusTimestamps: {
            ...current.statusTimestamps,
            [stage.key]: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.id, engagementId))
        )
        .returning();
      return updated[0] ?? null;
    });
  }

  async updateEngagement(
    engagementId: string,
    fields: Partial<{ assignedToId: string | null; taxYear: number }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.engagement)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(eq(schema.engagement.orgId, this.orgId), eq(schema.engagement.id, engagementId))
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  /** Dashboard: engagement counts per stage (optionally one assignee's). */
  async countEngagementsByStage(assignedToId?: string) {
    return this.tx(async (tx) => {
      const conds = [eq(schema.engagement.orgId, this.orgId)];
      if (assignedToId) conds.push(eq(schema.engagement.assignedToId, assignedToId));
      const rows = await tx
        .select({ stageId: schema.engagement.stageId, count: sql<number>`count(*)::int` })
        .from(schema.engagement)
        .where(and(...conds))
        .groupBy(schema.engagement.stageId);
      return new Map(rows.map((r) => [r.stageId, r.count]));
    });
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
    // Every new firm starts from the default workflow template (ADR-0015);
    // owners customize it in Settings → Workflow stages.
    await tx
      .insert(schema.engagementStage)
      .values(DEFAULT_ENGAGEMENT_STAGES.map((s) => ({ orgId, ...s })));
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
