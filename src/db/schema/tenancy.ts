import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./auth";

/**
 * Tenancy core. Every tenant table carries org_id and is covered by
 * FORCE ROW LEVEL SECURITY policies (see drizzle/*_rls.sql) keyed on
 * current_setting('app.org_id'). The scoped repository layer
 * (src/db/scoped.ts) sets that per-transaction and additionally filters by
 * org_id explicitly — RLS is defense-in-depth, not the primary gate.
 */

export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

export const staffRole = pgEnum("staff_role", ["owner", "admin", "accountant", "clerk"]);

export const membershipStatus = pgEnum("membership_status", ["active", "deactivated"]);

export const actorType = pgEnum("actor_type", ["staff", "client", "system", "ai"]);

/**
 * Reminder automation config (M5). Policies key on stage CATEGORY only
 * (ADR-0015) — never stage keys/labels, which firms rename freely.
 */
export type ReminderSettings = {
  enabled: boolean;
  /** Nudge once an engagement has sat in an awaiting_docs-category stage this long. */
  awaiting_docs_days: number;
  /** Minimum days between nudges for the same engagement. */
  cadence_days: number;
  /** 'preferred' follows client.preferred_channel (falling back to whichever address exists). */
  channel: "preferred" | "email" | "sms";
  /** Message template to use; null = the org's seeded default by channel. */
  template_id: string | null;
};

export const defaultReminderSettings: ReminderSettings = {
  enabled: false,
  awaiting_docs_days: 7,
  cadence_days: 3,
  channel: "preferred",
  template_id: null,
};

export type OrgSettings = {
  ai_enabled: boolean;
  /** 'assigned_only' (default, ADR-0004): accountants see only their assigned
   *  clients. 'all_read': accountants read all firm clients, write assigned —
   *  the shared-visibility option for firms that prefer it. */
  accountant_scope_mode: "all_read" | "assigned_only";
  /** Absent on orgs created before M5 — read via reminderSettings(). */
  reminders?: ReminderSettings;
};

export const defaultOrgSettings: OrgSettings = {
  ai_enabled: true,
  // Customer decision (ADR-0004): accountants see only their assigned book.
  accountant_scope_mode: "assigned_only",
};

/** Settings-with-defaults accessor — pre-M5 orgs have no `reminders` key. */
export function reminderSettings(settings: OrgSettings): ReminderSettings {
  return { ...defaultReminderSettings, ...settings.reminders };
}

export const org = pgTable("org", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Toronto"),
  subscriptionStatus: subscriptionStatus("subscription_status").notNull().default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // 14-day app-level trial starts at org creation; Stripe's own trial takes
  // over once the owner completes Checkout.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default(defaultOrgSettings),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembership = pgTable(
  "org_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => staffUser.id, { onDelete: "cascade" }),
    role: staffRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    invitedBy: text("invited_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_membership_org_user_uq").on(t.orgId, t.userId),
    index("org_membership_user_id_idx").on(t.userId),
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    phone: text("phone"),
    name: text("name").notNull(),
    role: staffRole("role").notNull(),
    // sha256 of the invite token; the raw token exists only in the sent link.
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => staffUser.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_org_id_idx").on(t.orgId)]
);

/**
 * Append-only. The crm_app role is granted SELECT + INSERT only (no
 * UPDATE/DELETE — enforced in the RLS migration). Written by the permission
 * layer on every client-data read/write; never contains SIN, tokens, or
 * presigned URLs.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "restrict" }),
    actorType: actorType("actor_type").notNull(),
    actorUserId: text("actor_user_id").references(() => staffUser.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_id_created_idx").on(t.orgId, t.createdAt),
    index("audit_log_resource_idx").on(t.orgId, t.resourceType, t.resourceId),
  ]
);
