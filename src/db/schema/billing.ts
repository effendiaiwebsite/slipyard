import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org } from "./tenancy";

/**
 * Billing + messaging-outbox tables (M1).
 */

/**
 * Processed Stripe webhook events — idempotency guard. NOT org-scoped by RLS
 * (events arrive before we know the org; handler resolves org itself), and
 * only ever touched by the webhook route + tests.
 */
export const stripeEvent = pgTable("stripe_event", {
  id: text("id").primaryKey(), // Stripe event id (evt_...)
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxChannel = pgEnum("outbox_channel", ["email", "sms"]);
export const outboxStatus = pgEnum("outbox_status", ["queued", "sent", "failed"]);

/**
 * Every outbound email/SMS lands here first (§1: dev mode = console +
 * outbox table viewable in-app; real adapters flip status when they send).
 * Bodies may contain invite/magic links — treat rows as sensitive, never log
 * them, and RLS keeps them org-scoped.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    channel: outboxChannel("channel").notNull(),
    toAddress: text("to_address").notNull(), // email address or E.164 phone
    subject: text("subject"), // email only
    body: text("body").notNull(),
    status: outboxStatus("status").notNull().default("queued"),
    provider: text("provider"), // console | ses | smtp | twilio
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_org_created_idx").on(t.orgId, t.createdAt)]
);
