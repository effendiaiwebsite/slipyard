import { and, asc, desc, eq, ilike, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { db, schema } from ".";
import { DEFAULT_ENGAGEMENT_STAGES, type StageCategory } from "./schema";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/templates";

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

  async updateOutbox(
    outboxId: string,
    fields: Partial<{
      status: "queued" | "sent" | "failed";
      provider: string;
      providerMessageId: string | null;
      error: string | null;
      sentAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.outbox)
        .set(fields)
        .where(and(eq(schema.outbox.orgId, this.orgId), eq(schema.outbox.id, outboxId)))
        .returning();
      return rows[0] ?? null;
    });
  }

  // ---- message templates (M5) -------------------------------------------------

  async listMessageTemplates() {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.messageTemplate)
        .where(eq(schema.messageTemplate.orgId, this.orgId))
        .orderBy(asc(schema.messageTemplate.name))
    );
  }

  async getMessageTemplate(templateId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.messageTemplate)
        .where(
          and(
            eq(schema.messageTemplate.orgId, this.orgId),
            eq(schema.messageTemplate.id, templateId)
          )
        );
      return rows[0] ?? null;
    });
  }

  async createMessageTemplate(fields: {
    name: string;
    channel: "email" | "sms";
    subject?: string | null;
    body: string;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.messageTemplate)
        .values({ orgId: this.orgId, createdBy: this.userId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async updateMessageTemplate(
    templateId: string,
    fields: Partial<{
      name: string;
      subject: string | null;
      body: string;
      archivedAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.messageTemplate)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(schema.messageTemplate.orgId, this.orgId),
            eq(schema.messageTemplate.id, templateId)
          )
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  // ---- messages (M5 send log) -------------------------------------------------

  async createMessage(fields: {
    clientId: string;
    engagementId?: string | null;
    templateId?: string | null;
    batchId?: string | null;
    kind: "manual" | "mass" | "reminder";
    channel: "email" | "sms";
    toAddress: string;
    subject?: string | null;
    body: string;
    status?: "queued" | "sent" | "failed" | "skipped";
    skipReason?: string | null;
    outboxId?: string | null;
    error?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.message)
        .values({
          orgId: this.orgId,
          createdBy: this.userId,
          sentAt: fields.status === "sent" ? new Date() : null,
          ...fields,
        })
        .returning();
      return rows[0];
    });
  }

  async getMessage(messageId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.message)
        .where(and(eq(schema.message.orgId, this.orgId), eq(schema.message.id, messageId)));
      return rows[0] ?? null;
    });
  }

  async updateMessage(
    messageId: string,
    fields: Partial<{
      status: "queued" | "sent" | "failed" | "skipped";
      skipReason: string | null;
      outboxId: string | null;
      error: string | null;
      sentAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.message)
        .set(fields)
        .where(and(eq(schema.message.orgId, this.orgId), eq(schema.message.id, messageId)))
        .returning();
      return rows[0] ?? null;
    });
  }

  /** Send log (Messages page): recent messages with client names. */
  async listRecentMessages(limit = 200) {
    return this.tx((tx) =>
      tx
        .select({
          message: schema.message,
          clientName: schema.client.displayName,
          templateName: schema.messageTemplate.name,
          senderName: schema.staffUser.name,
        })
        .from(schema.message)
        .innerJoin(schema.client, eq(schema.message.clientId, schema.client.id))
        .leftJoin(schema.messageTemplate, eq(schema.message.templateId, schema.messageTemplate.id))
        .leftJoin(schema.staffUser, eq(schema.message.createdBy, schema.staffUser.id))
        .where(eq(schema.message.orgId, this.orgId))
        .orderBy(desc(schema.message.createdAt))
        .limit(limit)
    );
  }

  /** Reminder cadence guard: when was this engagement last nudged? */
  async latestReminderAt(engagementId: string): Promise<Date | null> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({ createdAt: schema.message.createdAt })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.orgId, this.orgId),
            eq(schema.message.engagementId, engagementId),
            eq(schema.message.kind, "reminder"),
            ne(schema.message.status, "failed")
          )
        )
        .orderBy(desc(schema.message.createdAt))
        .limit(1);
      return rows[0]?.createdAt ?? null;
    });
  }

  /**
   * Reminder sweep input: engagements whose CURRENT stage has the given
   * category (ADR-0015 — automations never key on stage keys/labels), with
   * the client fields channel resolution needs.
   */
  async listEngagementsByStageCategory(category: StageCategory) {
    return this.tx((tx) =>
      tx
        .select({
          engagement: schema.engagement,
          stage: schema.engagementStage,
          client: {
            id: schema.client.id,
            displayName: schema.client.displayName,
            email: schema.client.email,
            phone: schema.client.phone,
            preferredChannel: schema.client.preferredChannel,
            smsOptOutAt: schema.client.smsOptOutAt,
            status: schema.client.status,
          },
          accountantName: schema.staffUser.name,
        })
        .from(schema.engagement)
        .innerJoin(
          schema.engagementStage,
          eq(schema.engagement.stageId, schema.engagementStage.id)
        )
        .innerJoin(schema.client, eq(schema.engagement.clientId, schema.client.id))
        .leftJoin(schema.staffUser, eq(schema.engagement.assignedToId, schema.staffUser.id))
        .where(
          and(
            eq(schema.engagement.orgId, this.orgId),
            eq(schema.engagementStage.category, category)
          )
        )
    );
  }

  /** STOP/START consent flip — audited by the caller. */
  async setClientSmsOptOut(clientId: string, optedOut: boolean) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.client)
        .set({ smsOptOutAt: optedOut ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(schema.client.orgId, this.orgId), eq(schema.client.id, clientId)))
        .returning();
      return rows[0] ?? null;
    });
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

  // ---- documents (M3) ---------------------------------------------------------

  async createDocument(fields: {
    clientId: string;
    engagementId?: string | null;
    filename: string;
    contentType: string;
    sizeBytes: number;
    s3Key: string;
    status?: "pending_scan" | "clean" | "infected" | "scan_failed";
    source?: "staff_upload" | "portal_upload" | "esign_executed";
    uploadedBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.document)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async getDocument(documentId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.document)
        .where(and(eq(schema.document.orgId, this.orgId), eq(schema.document.id, documentId)));
      return rows[0] ?? null;
    });
  }

  async updateDocument(
    documentId: string,
    fields: Partial<{
      engagementId: string | null;
      s3Key: string;
      status: "pending_scan" | "clean" | "infected" | "scan_failed";
      scanResult: string | null;
      scannedAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.document)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(schema.document.orgId, this.orgId), eq(schema.document.id, documentId)))
        .returning();
      return rows[0] ?? null;
    });
  }

  /** Row delete — callers handle the S3 object and restrict to infected/scan_failed. */
  async deleteDocument(documentId: string) {
    return this.tx((tx) =>
      tx
        .delete(schema.document)
        .where(and(eq(schema.document.orgId, this.orgId), eq(schema.document.id, documentId)))
    );
  }

  async listDocumentsByClient(clientId: string) {
    return this.tx((tx) =>
      tx
        .select({ document: schema.document, uploaderName: schema.staffUser.name })
        .from(schema.document)
        .leftJoin(schema.staffUser, eq(schema.document.uploadedBy, schema.staffUser.id))
        .where(
          and(eq(schema.document.orgId, this.orgId), eq(schema.document.clientId, clientId))
        )
        .orderBy(desc(schema.document.createdAt))
    );
  }

  /**
   * Intake queue: documents not yet filed against an engagement. Clerk
   * uploads land here; assignment (documents.manage) files them.
   */
  async listIntakeDocuments() {
    return this.tx((tx) =>
      tx
        .select({
          document: schema.document,
          clientName: schema.client.displayName,
          uploaderName: schema.staffUser.name,
        })
        .from(schema.document)
        .innerJoin(schema.client, eq(schema.document.clientId, schema.client.id))
        .leftJoin(schema.staffUser, eq(schema.document.uploadedBy, schema.staffUser.id))
        .where(and(eq(schema.document.orgId, this.orgId), isNull(schema.document.engagementId)))
        .orderBy(desc(schema.document.createdAt))
    );
  }

  // ---- checklists (M3) --------------------------------------------------------

  /** Bulk insert at instantiation (template) — positions come from the caller. */
  async createChecklistItems(
    engagementId: string,
    items: Array<{ title: string; required: boolean; position: number }>
  ) {
    if (items.length === 0) return [];
    return this.tx((tx) =>
      tx
        .insert(schema.checklistItem)
        .values(items.map((i) => ({ orgId: this.orgId, engagementId, ...i })))
        .returning()
    );
  }

  async listChecklistItems(engagementId: string) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.checklistItem)
        .where(
          and(
            eq(schema.checklistItem.orgId, this.orgId),
            eq(schema.checklistItem.engagementId, engagementId)
          )
        )
        .orderBy(asc(schema.checklistItem.position), asc(schema.checklistItem.createdAt))
    );
  }

  /** All items for a client's engagements in one query (detail page). */
  async listChecklistItemsForClient(clientId: string) {
    return this.tx((tx) =>
      tx
        .select({ item: schema.checklistItem })
        .from(schema.checklistItem)
        .innerJoin(
          schema.engagement,
          eq(schema.checklistItem.engagementId, schema.engagement.id)
        )
        .where(
          and(
            eq(schema.checklistItem.orgId, this.orgId),
            eq(schema.engagement.clientId, clientId)
          )
        )
        .orderBy(asc(schema.checklistItem.position), asc(schema.checklistItem.createdAt))
    );
  }

  async getChecklistItem(itemId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.checklistItem)
        .where(
          and(eq(schema.checklistItem.orgId, this.orgId), eq(schema.checklistItem.id, itemId))
        );
      return rows[0] ?? null;
    });
  }

  async addChecklistItem(engagementId: string, title: string, required: boolean) {
    return this.tx(async (tx) => {
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<number>`coalesce(max(position), -1)::int` })
        .from(schema.checklistItem)
        .where(
          and(
            eq(schema.checklistItem.orgId, this.orgId),
            eq(schema.checklistItem.engagementId, engagementId)
          )
        );
      const rows = await tx
        .insert(schema.checklistItem)
        .values({ orgId: this.orgId, engagementId, title, required, position: maxPos + 1 })
        .returning();
      return rows[0];
    });
  }

  async updateChecklistItem(
    itemId: string,
    fields: Partial<{
      status: "missing" | "received" | "waived";
      documentId: string | null;
      title: string;
      required: boolean;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.checklistItem)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(eq(schema.checklistItem.orgId, this.orgId), eq(schema.checklistItem.id, itemId))
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  async deleteChecklistItem(itemId: string) {
    return this.tx((tx) =>
      tx
        .delete(schema.checklistItem)
        .where(
          and(eq(schema.checklistItem.orgId, this.orgId), eq(schema.checklistItem.id, itemId))
        )
    );
  }

  /**
   * Returns/missing-docs rollup: per engagement, how many required items
   * exist and how many are still missing (received/waived count as done).
   */
  async listChecklistSummaries() {
    return this.tx((tx) =>
      tx
        .select({
          engagementId: schema.checklistItem.engagementId,
          total: sql<number>`count(*)::int`,
          requiredTotal: sql<number>`count(*) filter (where required)::int`,
          requiredMissing: sql<number>`count(*) filter (where required and status = 'missing')::int`,
        })
        .from(schema.checklistItem)
        .where(eq(schema.checklistItem.orgId, this.orgId))
        .groupBy(schema.checklistItem.engagementId)
    );
  }

  /** All still-missing items (missing-docs dashboard + intake assignment). */
  async listMissingChecklistItems() {
    return this.tx((tx) =>
      tx
        .select({
          id: schema.checklistItem.id,
          engagementId: schema.checklistItem.engagementId,
          title: schema.checklistItem.title,
          required: schema.checklistItem.required,
        })
        .from(schema.checklistItem)
        .where(
          and(
            eq(schema.checklistItem.orgId, this.orgId),
            eq(schema.checklistItem.status, "missing")
          )
        )
        .orderBy(asc(schema.checklistItem.position))
    );
  }

  // ---- portal tokens (M4) -----------------------------------------------------

  async createPortalToken(fields: {
    id: string;
    clientId: string;
    tokenHash: string;
    recipientName: string;
    recipientPhone: string;
    isHelper?: boolean;
    helperRelationship?: string | null;
    includeHousehold?: boolean;
    scopes?: string[];
    expiresAt: Date;
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.portalToken)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async getPortalToken(tokenId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.portalToken)
        .where(
          and(eq(schema.portalToken.orgId, this.orgId), eq(schema.portalToken.id, tokenId))
        );
      return rows[0] ?? null;
    });
  }

  async getPortalTokenByHash(tokenHash: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.portalToken)
        .where(
          and(
            eq(schema.portalToken.orgId, this.orgId),
            eq(schema.portalToken.tokenHash, tokenHash)
          )
        );
      return rows[0] ?? null;
    });
  }

  /** Staff UI: links for one client, newest first (active and dead alike). */
  async listPortalTokensForClient(clientId: string) {
    return this.tx((tx) =>
      tx
        .select({ token: schema.portalToken, createdByName: schema.staffUser.name })
        .from(schema.portalToken)
        .leftJoin(schema.staffUser, eq(schema.portalToken.createdBy, schema.staffUser.id))
        .where(
          and(
            eq(schema.portalToken.orgId, this.orgId),
            eq(schema.portalToken.clientId, clientId)
          )
        )
        .orderBy(desc(schema.portalToken.createdAt))
        .limit(20)
    );
  }

  async updatePortalToken(
    tokenId: string,
    fields: Partial<{
      openedAt: Date | null;
      otpHash: string | null;
      otpExpiresAt: Date | null;
      otpAttempts: number;
      verifiedAt: Date | null;
      revokedAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.portalToken)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(eq(schema.portalToken.orgId, this.orgId), eq(schema.portalToken.id, tokenId))
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  /** Atomic wrong-OTP counter — concurrent guesses can't skip the cap. */
  async incrementPortalOtpAttempts(tokenId: string): Promise<number> {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.portalToken)
        .set({ otpAttempts: sql`${schema.portalToken.otpAttempts} + 1`, updatedAt: new Date() })
        .where(
          and(eq(schema.portalToken.orgId, this.orgId), eq(schema.portalToken.id, tokenId))
        )
        .returning({ otpAttempts: schema.portalToken.otpAttempts });
      return rows[0]?.otpAttempts ?? Number.MAX_SAFE_INTEGER;
    });
  }

  // ---- portal reads (M4 — token-scoped, no staff user) ------------------------

  /** Everyone in a household (portal trusted-helper scope). */
  async listHouseholdClients(householdId: string) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.client)
        .where(
          and(
            eq(schema.client.orgId, this.orgId),
            eq(schema.client.householdId, householdId),
            eq(schema.client.status, "active")
          )
        )
        .orderBy(schema.client.displayName)
    );
  }

  /** Engagements (with stage) for a set of clients — portal home/checklist. */
  async listEngagementsForClients(clientIds: string[]) {
    if (clientIds.length === 0) return [];
    return this.tx((tx) =>
      tx
        .select({
          engagement: schema.engagement,
          stage: schema.engagementStage,
          clientName: schema.client.displayName,
        })
        .from(schema.engagement)
        .innerJoin(
          schema.engagementStage,
          eq(schema.engagement.stageId, schema.engagementStage.id)
        )
        .innerJoin(schema.client, eq(schema.engagement.clientId, schema.client.id))
        .where(
          and(
            eq(schema.engagement.orgId, this.orgId),
            inArray(schema.engagement.clientId, clientIds)
          )
        )
        .orderBy(desc(schema.engagement.taxYear), desc(schema.engagement.createdAt))
    );
  }

  async listChecklistItemsForEngagements(engagementIds: string[]) {
    if (engagementIds.length === 0) return [];
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.checklistItem)
        .where(
          and(
            eq(schema.checklistItem.orgId, this.orgId),
            inArray(schema.checklistItem.engagementId, engagementIds)
          )
        )
        .orderBy(asc(schema.checklistItem.position), asc(schema.checklistItem.createdAt))
    );
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

  // ---- signature requests (M6) ------------------------------------------------

  async createSignatureRequest(fields: {
    clientId: string;
    documentId: string;
    engagementId?: string | null;
    title: string;
    mode?: "remote" | "in_person";
    signerName: string;
    signerEmail?: string | null;
    signerPhone?: string | null;
    placements?: schema.FieldPlacement[];
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.signatureRequest)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async getSignatureRequest(requestId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.signatureRequest)
        .where(
          and(
            eq(schema.signatureRequest.orgId, this.orgId),
            eq(schema.signatureRequest.id, requestId)
          )
        );
      return rows[0] ?? null;
    });
  }

  async updateSignatureRequest(
    requestId: string,
    fields: Partial<{
      title: string;
      mode: "remote" | "in_person";
      status: "draft" | "sent" | "viewed" | "signed" | "declined" | "canceled";
      engagementId: string | null;
      placements: schema.FieldPlacement[];
      signerName: string;
      signerEmail: string | null;
      signerPhone: string | null;
      sourceHash: string | null;
      signedDocumentId: string | null;
      signedHash: string | null;
      signatureMethod: "drawn" | "typed" | null;
      signedVia: string | null;
      signedIp: string | null;
      signedTokenId: string | null;
      signedByStaffId: string | null;
      declineReason: string | null;
      sentAt: Date | null;
      viewedAt: Date | null;
      signedAt: Date | null;
      declinedAt: Date | null;
      canceledAt: Date | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.signatureRequest)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(schema.signatureRequest.orgId, this.orgId),
            eq(schema.signatureRequest.id, requestId)
          )
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  /** E-sign dashboard: every request with signer/creator/document context. */
  async listSignatureRequests(opts?: { assignedToId?: string }) {
    return this.tx((tx) => {
      const conds = [eq(schema.signatureRequest.orgId, this.orgId)];
      // Assigned-only scoping mirrors clients.view: an accountant sees only
      // requests for their own clients.
      if (opts?.assignedToId) conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));
      return tx
        .select({
          request: schema.signatureRequest,
          clientName: schema.client.displayName,
          documentName: schema.document.filename,
          createdByName: schema.staffUser.name,
        })
        .from(schema.signatureRequest)
        .innerJoin(schema.client, eq(schema.signatureRequest.clientId, schema.client.id))
        .innerJoin(schema.document, eq(schema.signatureRequest.documentId, schema.document.id))
        .leftJoin(schema.staffUser, eq(schema.signatureRequest.createdBy, schema.staffUser.id))
        .where(and(...conds))
        .orderBy(desc(schema.signatureRequest.createdAt));
    });
  }

  async listSignatureRequestsForClient(clientId: string) {
    return this.tx((tx) =>
      tx
        .select({
          request: schema.signatureRequest,
          documentName: schema.document.filename,
          createdByName: schema.staffUser.name,
        })
        .from(schema.signatureRequest)
        .innerJoin(schema.document, eq(schema.signatureRequest.documentId, schema.document.id))
        .leftJoin(schema.staffUser, eq(schema.signatureRequest.createdBy, schema.staffUser.id))
        .where(
          and(
            eq(schema.signatureRequest.orgId, this.orgId),
            eq(schema.signatureRequest.clientId, clientId)
          )
        )
        .orderBy(desc(schema.signatureRequest.createdAt))
    );
  }

  /** Portal "Sign a form": pending (sent/viewed) requests for a set of clients. */
  async listPendingSignatureRequestsForClients(clientIds: string[]) {
    if (clientIds.length === 0) return [];
    return this.tx((tx) =>
      tx
        .select({
          request: schema.signatureRequest,
          clientName: schema.client.displayName,
          documentName: schema.document.filename,
        })
        .from(schema.signatureRequest)
        .innerJoin(schema.client, eq(schema.signatureRequest.clientId, schema.client.id))
        .innerJoin(schema.document, eq(schema.signatureRequest.documentId, schema.document.id))
        .where(
          and(
            eq(schema.signatureRequest.orgId, this.orgId),
            inArray(schema.signatureRequest.clientId, clientIds),
            inArray(schema.signatureRequest.status, ["sent", "viewed"])
          )
        )
        .orderBy(desc(schema.signatureRequest.createdAt))
    );
  }

  /** Count of open (draft/sent/viewed) requests — dashboard card. */
  async countOpenSignatureRequests(assignedToId?: string): Promise<number> {
    return this.tx(async (tx) => {
      const conds = [
        eq(schema.signatureRequest.orgId, this.orgId),
        inArray(schema.signatureRequest.status, ["draft", "sent", "viewed"]),
      ];
      if (assignedToId) conds.push(eq(schema.client.assignedAccountantId, assignedToId));
      const rows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.signatureRequest)
        .innerJoin(schema.client, eq(schema.signatureRequest.clientId, schema.client.id))
        .where(and(...conds));
      return rows[0]?.count ?? 0;
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
    // ...and the default message templates (M5); owners edit them in
    // Settings → Templates.
    await tx
      .insert(schema.messageTemplate)
      .values(DEFAULT_MESSAGE_TEMPLATES.map((t) => ({ orgId, ...t })));
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
 * Reminders sweep (M5): enumerate orgs — a system job with no org context.
 * RLS policy `org_system_sweep` exposes org rows only while the
 * app.system_job GUC is armed (ADR-0009 pattern; crm_app-internal, never
 * reachable from request input). Per-org work then goes through a normal
 * OrgScope(orgId, null).
 */
export async function listOrgsForReminderSweep() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system_job', 'reminders-sweep', true)`);
    return tx
      .select({ id: schema.org.id, name: schema.org.name, settings: schema.org.settings })
      .from(schema.org);
  });
}

/**
 * Twilio inbound webhook (STOP/START): find every client with this phone —
 * across orgs, because the sender's org is unknowable from the SMS alone
 * (and a phone shared across two firms should opt out of both). RLS policy
 * `client_by_phone` keys on the GUC; the caller has already validated the
 * Twilio signature. Consent flips then run per-org via OrgScope.
 */
export async function findClientsByPhone(phone: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.sms_from', ${phone}, true)`);
    return tx
      .select({
        id: schema.client.id,
        orgId: schema.client.orgId,
        smsOptOutAt: schema.client.smsOptOutAt,
      })
      .from(schema.client)
      .where(eq(schema.client.phone, phone));
  });
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
