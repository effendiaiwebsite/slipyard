import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { outbox, outboxChannel } from "./billing";
import { client, engagement } from "./clients";
import { org } from "./tenancy";

/**
 * Messaging (M5): reusable templates and the per-client send log.
 * Both tenant tables — org_id + FORCEd RLS (drizzle/0016_m5_rls.sql).
 *
 * Three layers, three jobs:
 *   message_template — what staff write and reuse (Settings → Templates)
 *   message          — one row per client-facing send: what went to whom,
 *                      rendered body, outcome (the send log / audit surface)
 *   outbox           — the transport row (M1); message.outbox_id links them.
 * A message with no outbox row was skipped before transport (opt-out,
 * missing address) — skip_reason says why.
 */

export const messageKind = pgEnum("message_kind", ["manual", "mass", "reminder"]);

export const messageStatus = pgEnum("message_status", ["queued", "sent", "failed", "skipped"]);

export const messageTemplate = pgTable(
  "message_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: outboxChannel("channel").notNull(),
    subject: text("subject"), // email only
    // Plain text with {variable} placeholders — see src/lib/templates.ts.
    body: text("body").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("message_template_org_name_uq").on(t.orgId, t.name)]
);

export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").references(() => engagement.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => messageTemplate.id, { onDelete: "set null" }),
    /** Groups the rows of one mass send. */
    batchId: uuid("batch_id"),
    kind: messageKind("kind").notNull(),
    channel: outboxChannel("channel").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("queued"),
    /** Set when status = skipped: sms_opt_out | no_address. */
    skipReason: text("skip_reason"),
    outboxId: uuid("outbox_id").references(() => outbox.id, { onDelete: "set null" }),
    error: text("error"),
    /** Null for system sends (reminders). */
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("message_org_client_created_idx").on(t.orgId, t.clientId, t.createdAt),
    index("message_org_batch_idx").on(t.orgId, t.batchId),
    // Reminder cadence lookups: latest reminder per engagement.
    index("message_org_engagement_kind_idx").on(t.orgId, t.engagementId, t.kind, t.createdAt),
  ]
);
