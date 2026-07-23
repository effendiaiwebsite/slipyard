import { and, asc, desc, eq, ilike, inArray, isNull, lte, max, ne, sql } from "drizzle-orm";
import { db, schema } from ".";
import { DEFAULT_ENGAGEMENT_STAGES, type StageCategory } from "./schema";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/templates";
import { computeTotals, linesFromEntries } from "@/lib/timebilling";
import type { MappedClient } from "@/lib/imports";

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

  // ---- CRA authorizations (M7) ------------------------------------------------

  /** Coverage page: every authorization row with client context. */
  async listAuthorizations(opts?: { assignedToId?: string }) {
    return this.tx((tx) => {
      const conds = [eq(schema.craAuthorization.orgId, this.orgId)];
      if (opts?.assignedToId) conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));
      return tx
        .select({
          auth: schema.craAuthorization,
          clientName: schema.client.displayName,
        })
        .from(schema.craAuthorization)
        .innerJoin(schema.client, eq(schema.craAuthorization.clientId, schema.client.id))
        .where(and(...conds))
        .orderBy(desc(schema.craAuthorization.createdAt));
    });
  }

  async listAuthorizationsForClient(clientId: string) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.craAuthorization)
        .where(
          and(
            eq(schema.craAuthorization.orgId, this.orgId),
            eq(schema.craAuthorization.clientId, clientId)
          )
        )
        .orderBy(desc(schema.craAuthorization.createdAt))
    );
  }

  async getAuthorization(id: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.craAuthorization)
        .where(
          and(eq(schema.craAuthorization.orgId, this.orgId), eq(schema.craAuthorization.id, id))
        );
      return rows[0] ?? null;
    });
  }

  async createAuthorization(fields: {
    clientId: string;
    level: "level1" | "level2" | "level3";
    status?: "pending" | "active" | "expired" | "revoked";
    expiryDate?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.craAuthorization)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async updateAuthorization(
    id: string,
    fields: Partial<{
      level: "level1" | "level2" | "level3";
      status: "pending" | "active" | "expired" | "revoked";
      expiryDate: string | null;
      notes: string | null;
    }>
  ) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(schema.craAuthorization)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(eq(schema.craAuthorization.orgId, this.orgId), eq(schema.craAuthorization.id, id))
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  async deleteAuthorization(id: string) {
    return this.tx((tx) =>
      tx
        .delete(schema.craAuthorization)
        .where(
          and(eq(schema.craAuthorization.orgId, this.orgId), eq(schema.craAuthorization.id, id))
        )
    );
  }

  /**
   * Dashboard card: ACTIVE clients with no currently-usable authorization —
   * no row that is status 'active' and unexpired (expiry semantics match
   * src/lib/authorizations.ts effectiveAuthStatus).
   */
  async countClientsWithoutActiveAuthorization(assignedToId?: string): Promise<number> {
    return this.tx(async (tx) => {
      const conds = [
        eq(schema.client.orgId, this.orgId),
        eq(schema.client.status, "active"),
        sql`not exists (
          select 1 from cra_authorization a
          where a.client_id = ${schema.client.id}
            and a.org_id = ${this.orgId}
            and a.status = 'active'
            and (a.expiry_date is null or a.expiry_date >= current_date)
        )`,
      ];
      if (assignedToId) conds.push(eq(schema.client.assignedAccountantId, assignedToId));
      const rows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.client)
        .where(and(...conds));
      return rows[0]?.count ?? 0;
    });
  }

  // ---- time & billing (M7) ----------------------------------------------------

  async createTimeEntry(fields: {
    clientId: string;
    engagementId?: string | null;
    userId: string;
    workDate: string;
    minutes: number;
    description: string;
    rateCents: number;
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.timeEntry)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async getTimeEntry(id: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.timeEntry)
        .where(and(eq(schema.timeEntry.orgId, this.orgId), eq(schema.timeEntry.id, id)));
      return rows[0] ?? null;
    });
  }

  /** Time log with client + worker names. Assigned-only scoping mirrors clients.view. */
  async listTimeEntries(opts?: {
    clientId?: string;
    unbilledOnly?: boolean;
    assignedToId?: string;
    limit?: number;
  }) {
    return this.tx((tx) => {
      const conds = [eq(schema.timeEntry.orgId, this.orgId)];
      if (opts?.clientId) conds.push(eq(schema.timeEntry.clientId, opts.clientId));
      if (opts?.unbilledOnly) conds.push(isNull(schema.timeEntry.invoiceId));
      if (opts?.assignedToId) conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));
      return tx
        .select({
          entry: schema.timeEntry,
          clientName: schema.client.displayName,
          userName: schema.staffUser.name,
        })
        .from(schema.timeEntry)
        .innerJoin(schema.client, eq(schema.timeEntry.clientId, schema.client.id))
        .leftJoin(schema.staffUser, eq(schema.timeEntry.userId, schema.staffUser.id))
        .where(and(...conds))
        .orderBy(desc(schema.timeEntry.workDate), desc(schema.timeEntry.createdAt))
        .limit(opts?.limit ?? 500);
    });
  }

  /** Delete an unbilled entry (typo). Invoiced entries are immutable history. */
  async deleteTimeEntry(id: string) {
    return this.tx((tx) =>
      tx
        .delete(schema.timeEntry)
        .where(
          and(
            eq(schema.timeEntry.orgId, this.orgId),
            eq(schema.timeEntry.id, id),
            isNull(schema.timeEntry.invoiceId)
          )
        )
    );
  }

  /**
   * Invoice a set of the client's unbilled entries, atomically: snapshot them
   * into lines, take the org's next invoice number, stamp the entries
   * (ADR-0030). Ignores ids that aren't the client's unbilled entries.
   */
  async createInvoiceWithEntries(fields: {
    clientId: string;
    entryIds: string[];
    issueDate: string;
    dueDate?: string | null;
    taxLabel: string;
    taxRateBps: number;
    notes?: string | null;
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const entries = await tx
        .select()
        .from(schema.timeEntry)
        .where(
          and(
            eq(schema.timeEntry.orgId, this.orgId),
            eq(schema.timeEntry.clientId, fields.clientId),
            inArray(schema.timeEntry.id, fields.entryIds),
            isNull(schema.timeEntry.invoiceId)
          )
        )
        .orderBy(asc(schema.timeEntry.workDate), asc(schema.timeEntry.createdAt));
      if (entries.length === 0) return null;

      const numberRows = await tx
        .select({ next: sql<number>`coalesce(max(${schema.invoice.number}), 0)::int + 1` })
        .from(schema.invoice)
        .where(eq(schema.invoice.orgId, this.orgId));
      const number = numberRows[0]?.next ?? 1;

      const lines = linesFromEntries(entries);
      const totals = computeTotals(lines, fields.taxRateBps);
      const rows = await tx
        .insert(schema.invoice)
        .values({
          orgId: this.orgId,
          clientId: fields.clientId,
          number,
          issueDate: fields.issueDate,
          dueDate: fields.dueDate ?? null,
          lines,
          subtotalCents: totals.subtotalCents,
          taxLabel: fields.taxLabel,
          taxRateBps: fields.taxRateBps,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          notes: fields.notes ?? null,
          createdBy: fields.createdBy ?? null,
        })
        .returning();
      const invoice = rows[0];

      await tx
        .update(schema.timeEntry)
        .set({ invoiceId: invoice.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.timeEntry.orgId, this.orgId),
            inArray(
              schema.timeEntry.id,
              entries.map((e) => e.id)
            )
          )
        );
      return invoice;
    });
  }

  async listInvoices(opts?: { assignedToId?: string }) {
    return this.tx((tx) => {
      const conds = [eq(schema.invoice.orgId, this.orgId)];
      if (opts?.assignedToId) conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));
      return tx
        .select({
          invoice: schema.invoice,
          clientName: schema.client.displayName,
        })
        .from(schema.invoice)
        .innerJoin(schema.client, eq(schema.invoice.clientId, schema.client.id))
        .where(and(...conds))
        .orderBy(desc(schema.invoice.number));
    });
  }

  async getInvoice(id: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.invoice)
        .where(and(eq(schema.invoice.orgId, this.orgId), eq(schema.invoice.id, id)));
      return rows[0] ?? null;
    });
  }

  /**
   * Status transitions. Voiding releases the invoice's time entries back to
   * WIP (their invoice_id clears) — the lines snapshot stays on the voided
   * row for the record (ADR-0030).
   */
  async setInvoiceStatus(id: string, status: "sent" | "paid" | "void") {
    return this.tx(async (tx) => {
      const stamp =
        status === "sent"
          ? { sentAt: new Date() }
          : status === "paid"
            ? { paidAt: new Date() }
            : { voidedAt: new Date() };
      const rows = await tx
        .update(schema.invoice)
        .set({ status, ...stamp, updatedAt: new Date() })
        .where(and(eq(schema.invoice.orgId, this.orgId), eq(schema.invoice.id, id)))
        .returning();
      const invoice = rows[0] ?? null;
      if (invoice && status === "void") {
        await tx
          .update(schema.timeEntry)
          .set({ invoiceId: null, updatedAt: new Date() })
          .where(
            and(eq(schema.timeEntry.orgId, this.orgId), eq(schema.timeEntry.invoiceId, id))
          );
      }
      return invoice;
    });
  }

  /** Org-wide quarantine view (M8 audit-risk rules): infected / scan_failed. */
  async listProblemDocuments(opts?: { assignedToId?: string }) {
    return this.tx((tx) => {
      const conds = [
        eq(schema.document.orgId, this.orgId),
        inArray(schema.document.status, ["infected", "scan_failed"]),
      ];
      if (opts?.assignedToId) conds.push(eq(schema.client.assignedAccountantId, opts.assignedToId));
      return tx
        .select({
          id: schema.document.id,
          clientId: schema.document.clientId,
          clientName: schema.client.displayName,
          filename: schema.document.filename,
          status: schema.document.status,
          createdAt: schema.document.createdAt,
        })
        .from(schema.document)
        .innerJoin(schema.client, eq(schema.document.clientId, schema.client.id))
        .where(and(...conds))
        .orderBy(desc(schema.document.createdAt));
    });
  }

  // ---- AI interaction log (M8) --------------------------------------------

  async createAiInteraction(fields: {
    userId: string;
    feature: schema.AiFeatureName;
    prompt: string;
    response: string;
    toolsUsed: schema.AiToolUse[];
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }) {
    return this.tx(async (tx) => {
      const rows = await tx
        .insert(schema.aiInteraction)
        .values({ orgId: this.orgId, ...fields })
        .returning();
      return rows[0];
    });
  }

  async listAiInteractions(opts?: { userId?: string; limit?: number }) {
    return this.tx((tx) => {
      const conds = [eq(schema.aiInteraction.orgId, this.orgId)];
      if (opts?.userId) conds.push(eq(schema.aiInteraction.userId, opts.userId));
      return tx
        .select()
        .from(schema.aiInteraction)
        .where(and(...conds))
        .orderBy(desc(schema.aiInteraction.createdAt))
        .limit(opts?.limit ?? 50);
    });
  }

  // ---- retention review (M9, ADR-0034) ---------------------------------------

  /**
   * Documents past the 7-year retention horizon, surfaced for owner/admin
   * review. Only KEPT documents (status 'clean' — vault uploads + executed
   * e-sign PDFs); quarantined/infected files aren't retention subjects. No
   * mutation — the flow is read-only by design (ADR-0034).
   */
  async listRetentionReviewDocuments(before: Date) {
    return this.tx((tx) =>
      tx
        .select({
          id: schema.document.id,
          filename: schema.document.filename,
          source: schema.document.source,
          createdAt: schema.document.createdAt,
          clientId: schema.document.clientId,
          clientName: schema.client.displayName,
        })
        .from(schema.document)
        .innerJoin(schema.client, eq(schema.document.clientId, schema.client.id))
        .where(
          and(
            eq(schema.document.orgId, this.orgId),
            eq(schema.document.status, "clean"),
            lte(schema.document.createdAt, before)
          )
        )
        .orderBy(asc(schema.document.createdAt))
    );
  }

  /** Count of kept documents for the retention posture card (total vs due). */
  async countRetentionDocuments(before: Date): Promise<{ total: number; due: number }> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          total: sql<number>`count(*)::int`,
          due: sql<number>`count(*) filter (where created_at <= ${before})::int`,
        })
        .from(schema.document)
        .where(and(eq(schema.document.orgId, this.orgId), eq(schema.document.status, "clean")));
      return { total: rows[0]?.total ?? 0, due: rows[0]?.due ?? 0 };
    });
  }

  // ---- generic import (M9, ADR-0033) -----------------------------------------

  /**
   * Persist a staged import batch: the batch header + one staging row per
   * parsed CSV row, in one transaction. Staging rows already carry masked/
   * encrypted SIN (buildStagedRows) — no plaintext SIN reaches the DB.
   */
  async createStagedImportBatch(batch: {
    kind?: "clients";
    filename: string;
    sourceColumns: string[];
    mapping: Record<string, string>;
    rows: Array<{
      rowNumber: number;
      raw: Record<string, string>;
      mapped: MappedClient;
      warnings: string[];
      action: "create" | "skip";
    }>;
    createdBy?: string | null;
  }) {
    return this.tx(async (tx) => {
      const createCount = batch.rows.filter((r) => r.action === "create").length;
      const warningCount = batch.rows.reduce((s, r) => s + r.warnings.length, 0);
      const [header] = await tx
        .insert(schema.importBatch)
        .values({
          orgId: this.orgId,
          kind: batch.kind ?? "clients",
          status: "staged",
          filename: batch.filename,
          sourceColumns: batch.sourceColumns,
          mapping: batch.mapping,
          rowCount: batch.rows.length,
          createdCount: 0,
          skippedCount: batch.rows.length - createCount,
          warningCount,
          createdBy: batch.createdBy ?? this.userId,
        })
        .returning();
      if (batch.rows.length > 0) {
        await tx.insert(schema.importStagingRow).values(
          batch.rows.map((r) => ({
            orgId: this.orgId,
            batchId: header.id,
            rowNumber: r.rowNumber,
            raw: r.raw,
            mapped: r.mapped as Record<string, unknown>,
            warnings: r.warnings,
            action: r.action,
          }))
        );
      }
      return header;
    });
  }

  async getImportBatch(id: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.importBatch)
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, id)));
      return rows[0] ?? null;
    });
  }

  async listImportBatches(limit = 25) {
    return this.tx((tx) =>
      tx
        .select({ batch: schema.importBatch, createdByName: schema.staffUser.name })
        .from(schema.importBatch)
        .leftJoin(schema.staffUser, eq(schema.importBatch.createdBy, schema.staffUser.id))
        .where(eq(schema.importBatch.orgId, this.orgId))
        .orderBy(desc(schema.importBatch.createdAt))
        .limit(limit)
    );
  }

  async listStagingRows(batchId: string) {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.importStagingRow)
        .where(
          and(
            eq(schema.importStagingRow.orgId, this.orgId),
            eq(schema.importStagingRow.batchId, batchId)
          )
        )
        .orderBy(asc(schema.importStagingRow.rowNumber))
    );
  }

  /** Discard a still-staged batch (nothing was created). */
  async deleteStagedImportBatch(id: string): Promise<"ok" | "not_found" | "not_staged"> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.importBatch)
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, id)));
      const batch = rows[0];
      if (!batch) return "not_found";
      if (batch.status !== "staged") return "not_staged";
      await tx
        .delete(schema.importBatch)
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, id)));
      return "ok";
    });
  }

  /**
   * Commit a staged batch: create a client per 'create' staging row (SIN
   * ciphertext copied straight across), stamp created_client_id, mark the
   * batch committed. Assigned-accountant emails are resolved to staff ids
   * here; a no-match appends a per-row warning and leaves the client
   * unassigned. Atomic — a failure rolls the whole insert back.
   */
  async commitImportBatch(
    batchId: string
  ): Promise<
    | { ok: false; reason: "not_found" | "not_staged" }
    | { ok: true; createdCount: number; unresolvedAccountants: number }
  > {
    return this.tx(async (tx) => {
      const batchRows = await tx
        .select()
        .from(schema.importBatch)
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, batchId)));
      const batch = batchRows[0];
      if (!batch) return { ok: false as const, reason: "not_found" as const };
      if (batch.status !== "staged") return { ok: false as const, reason: "not_staged" as const };

      const staging = await tx
        .select()
        .from(schema.importStagingRow)
        .where(
          and(
            eq(schema.importStagingRow.orgId, this.orgId),
            eq(schema.importStagingRow.batchId, batchId),
            eq(schema.importStagingRow.action, "create")
          )
        )
        .orderBy(asc(schema.importStagingRow.rowNumber));

      // Resolve assigned-accountant emails to staff ids (active members only).
      const members = await tx
        .select({ id: schema.staffUser.id, email: schema.staffUser.email })
        .from(schema.orgMembership)
        .innerJoin(schema.staffUser, eq(schema.orgMembership.userId, schema.staffUser.id))
        .where(
          and(
            eq(schema.orgMembership.orgId, this.orgId),
            eq(schema.orgMembership.status, "active")
          )
        );
      const emailToId = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));

      let createdCount = 0;
      let unresolvedAccountants = 0;
      for (const row of staging) {
        const m = row.mapped as MappedClient;
        if (!m.displayName) continue;
        let assignedAccountantId: string | null = null;
        if (m.assignedAccountantEmail) {
          assignedAccountantId = emailToId.get(m.assignedAccountantEmail) ?? null;
          if (!assignedAccountantId) unresolvedAccountants++;
        }
        const [created] = await tx
          .insert(schema.client)
          .values({
            orgId: this.orgId,
            type: m.type,
            displayName: m.displayName,
            email: m.email,
            phone: m.phone,
            preferredChannel: m.preferredChannel,
            addressLine1: m.addressLine1,
            city: m.city,
            province: m.province,
            postalCode: m.postalCode,
            dateOfBirth: m.dateOfBirth,
            sinEncrypted: m.sinEncrypted,
            sinLast3: m.sinLast3,
            assignedAccountantId,
            tags: m.tags ?? [],
            customFields: m.customFields ?? {},
            createdBy: this.userId,
          })
          .returning({ id: schema.client.id });

        const extraWarnings =
          m.assignedAccountantEmail && !assignedAccountantId
            ? [`Assigned accountant "${m.assignedAccountantEmail}" isn't a staff member — imported unassigned.`]
            : [];
        await tx
          .update(schema.importStagingRow)
          .set({
            createdClientId: created.id,
            warnings: extraWarnings.length ? [...row.warnings, ...extraWarnings] : row.warnings,
          })
          .where(
            and(
              eq(schema.importStagingRow.orgId, this.orgId),
              eq(schema.importStagingRow.id, row.id)
            )
          );
        createdCount++;
      }

      await tx
        .update(schema.importBatch)
        .set({
          status: "committed",
          createdCount,
          committedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, batchId)));

      return { ok: true as const, createdCount, unresolvedAccountants };
    });
  }

  /**
   * Client ids (within the given set) that have ANY dependent record — the
   * rollback guard. One distinct-client_id probe per referencing table; the
   * union is the blocked set. Small N (a batch's created clients), so the
   * handful of round trips is fine.
   */
  private async clientsWithDependents(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const org = this.orgId;
    const probes = [
      tx
        .selectDistinct({ c: schema.engagement.clientId })
        .from(schema.engagement)
        .where(and(eq(schema.engagement.orgId, org), inArray(schema.engagement.clientId, ids))),
      tx
        .selectDistinct({ c: schema.document.clientId })
        .from(schema.document)
        .where(and(eq(schema.document.orgId, org), inArray(schema.document.clientId, ids))),
      tx
        .selectDistinct({ c: schema.clientNote.clientId })
        .from(schema.clientNote)
        .where(and(eq(schema.clientNote.orgId, org), inArray(schema.clientNote.clientId, ids))),
      tx
        .selectDistinct({ c: schema.contactLog.clientId })
        .from(schema.contactLog)
        .where(and(eq(schema.contactLog.orgId, org), inArray(schema.contactLog.clientId, ids))),
      tx
        .selectDistinct({ c: schema.message.clientId })
        .from(schema.message)
        .where(and(eq(schema.message.orgId, org), inArray(schema.message.clientId, ids))),
      tx
        .selectDistinct({ c: schema.craAuthorization.clientId })
        .from(schema.craAuthorization)
        .where(
          and(eq(schema.craAuthorization.orgId, org), inArray(schema.craAuthorization.clientId, ids))
        ),
      tx
        .selectDistinct({ c: schema.timeEntry.clientId })
        .from(schema.timeEntry)
        .where(and(eq(schema.timeEntry.orgId, org), inArray(schema.timeEntry.clientId, ids))),
      tx
        .selectDistinct({ c: schema.invoice.clientId })
        .from(schema.invoice)
        .where(and(eq(schema.invoice.orgId, org), inArray(schema.invoice.clientId, ids))),
      tx
        .selectDistinct({ c: schema.signatureRequest.clientId })
        .from(schema.signatureRequest)
        .where(
          and(eq(schema.signatureRequest.orgId, org), inArray(schema.signatureRequest.clientId, ids))
        ),
      tx
        .selectDistinct({ c: schema.portalToken.clientId })
        .from(schema.portalToken)
        .where(and(eq(schema.portalToken.orgId, org), inArray(schema.portalToken.clientId, ids))),
    ];
    const blocked = new Set<string>();
    for (const probe of probes) {
      const rows = await probe;
      for (const r of rows) blocked.add(r.c);
    }
    return blocked;
  }

  /**
   * Undo a committed batch: hard-delete exactly the clients it created that
   * are still untouched. A client that gained dependents (engagements, docs,
   * notes, …) since import is KEPT and reported — the batch then lands as
   * 'partially_rolled_back' (ADR-0033). No other org data is affected.
   */
  async rollbackImportBatch(
    batchId: string
  ): Promise<
    | { ok: false; reason: "not_found" | "not_committed" }
    | { ok: true; removed: number; kept: Array<{ name: string }>; status: "rolled_back" | "partially_rolled_back" }
  > {
    return this.tx(async (tx) => {
      const batchRows = await tx
        .select()
        .from(schema.importBatch)
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, batchId)));
      const batch = batchRows[0];
      if (!batch) return { ok: false as const, reason: "not_found" as const };
      if (batch.status !== "committed" && batch.status !== "partially_rolled_back") {
        return { ok: false as const, reason: "not_committed" as const };
      }

      const staging = await tx
        .select({
          id: schema.importStagingRow.id,
          createdClientId: schema.importStagingRow.createdClientId,
        })
        .from(schema.importStagingRow)
        .where(
          and(
            eq(schema.importStagingRow.orgId, this.orgId),
            eq(schema.importStagingRow.batchId, batchId)
          )
        );
      const createdIds = staging
        .map((r) => r.createdClientId)
        .filter((v): v is string => v !== null);
      if (createdIds.length === 0) {
        await tx
          .update(schema.importBatch)
          .set({ status: "rolled_back", rolledBackAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, batchId)));
        return { ok: true as const, removed: 0, kept: [], status: "rolled_back" as const };
      }

      const blocked = await this.clientsWithDependents(tx, createdIds);
      const deletable = createdIds.filter((id) => !blocked.has(id));
      const keptIds = createdIds.filter((id) => blocked.has(id));

      const kept: Array<{ name: string }> = [];
      if (keptIds.length > 0) {
        const keptRows = await tx
          .select({ name: schema.client.displayName })
          .from(schema.client)
          .where(
            and(eq(schema.client.orgId, this.orgId), inArray(schema.client.id, keptIds))
          );
        for (const r of keptRows) kept.push({ name: r.name });
      }

      if (deletable.length > 0) {
        // FK on staging.created_client_id is ON DELETE SET NULL, so the
        // staging rows' pointers clear automatically as the clients go.
        await tx
          .delete(schema.client)
          .where(
            and(eq(schema.client.orgId, this.orgId), inArray(schema.client.id, deletable))
          );
      }

      const status: "rolled_back" | "partially_rolled_back" =
        keptIds.length > 0 ? "partially_rolled_back" : "rolled_back";
      await tx
        .update(schema.importBatch)
        .set({ status, rolledBackAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.importBatch.orgId, this.orgId), eq(schema.importBatch.id, batchId)));

      return { ok: true as const, removed: deletable.length, kept, status };
    });
  }

  // ---- import mapping templates (M9) -----------------------------------------

  async listImportMappingTemplates() {
    return this.tx((tx) =>
      tx
        .select()
        .from(schema.importMappingTemplate)
        .where(eq(schema.importMappingTemplate.orgId, this.orgId))
        .orderBy(asc(schema.importMappingTemplate.name))
    );
  }

  /** Save-or-replace a mapping template by name (unique per org). */
  async upsertImportMappingTemplate(name: string, mapping: Record<string, string>) {
    return this.tx(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.importMappingTemplate)
        .where(
          and(
            eq(schema.importMappingTemplate.orgId, this.orgId),
            eq(schema.importMappingTemplate.name, name)
          )
        );
      if (existing[0]) {
        const [row] = await tx
          .update(schema.importMappingTemplate)
          .set({ mapping, updatedAt: new Date() })
          .where(eq(schema.importMappingTemplate.id, existing[0].id))
          .returning();
        return row;
      }
      const [row] = await tx
        .insert(schema.importMappingTemplate)
        .values({ orgId: this.orgId, name, mapping, createdBy: this.userId })
        .returning();
      return row;
    });
  }

  async deleteImportMappingTemplate(id: string) {
    return this.tx((tx) =>
      tx
        .delete(schema.importMappingTemplate)
        .where(
          and(
            eq(schema.importMappingTemplate.orgId, this.orgId),
            eq(schema.importMappingTemplate.id, id)
          )
        )
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
