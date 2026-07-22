import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { org } from "./tenancy";

/**
 * Client hub (M2): clients, households, engagements, notes, contact log.
 * All tenant tables — org_id + FORCEd RLS (drizzle/0007_m2_rls.sql).
 *
 * SIN handling (§6): only ever stored app-encrypted (src/lib/crypto.ts
 * encryptField) in sin_encrypted; sin_last3 holds the three digits the mask
 * displays so lists never need to decrypt. Never in logs/URLs/exports.
 */

export const clientType = pgEnum("client_type", ["individual", "corporation", "trust"]);

export const clientStatus = pgEnum("client_status", ["active", "archived"]);

export const preferredChannel = pgEnum("preferred_channel", ["email", "sms", "phone", "mail"]);

export const client = pgTable(
  "client",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    type: clientType("type").notNull().default("individual"),
    status: clientStatus("status").notNull().default("active"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"), // E.164
    preferredChannel: preferredChannel("preferred_channel").notNull().default("phone"),
    addressLine1: text("address_line1"),
    city: text("city"),
    province: text("province"), // 2-letter, e.g. ON
    postalCode: text("postal_code"),
    dateOfBirth: date("date_of_birth"), // individuals; never sent to model APIs
    // AES-256-GCM ciphertext from encryptField(); null when SIN not on file.
    sinEncrypted: text("sin_encrypted"),
    // Last 3 digits only — what maskSin() shows; lets lists render the mask
    // without touching the ciphertext.
    sinLast3: text("sin_last3"),
    assignedAccountantId: text("assigned_accountant_id").references(() => staffUser.id),
    householdId: uuid("household_id").references(() => household.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default([]),
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default({}),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_org_name_idx").on(t.orgId, t.displayName),
    index("client_org_assigned_idx").on(t.orgId, t.assignedAccountantId),
    index("client_org_household_idx").on(t.orgId, t.householdId),
  ]
);

/** Family grouping (spouses, dependants) — display + portal trust scoping later. */
export const household = pgTable(
  "household",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g. "Tremblay household"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("household_org_idx").on(t.orgId)]
);

export const engagementType = pgEnum("engagement_type", ["t1", "t2", "t3", "other"]);

/**
 * The workflow pipeline (ADR-0013). Any→any transitions are allowed
 * (small-firm reality: work moves backwards too); every transition is
 * permission-checked, timestamped in status_timestamps, and audited.
 */
export const engagementStatus = pgEnum("engagement_status", [
  "not_started",
  "awaiting_docs",
  "in_preparation",
  "in_review",
  "awaiting_signature",
  "filed",
  "noa_received",
]);

export const ENGAGEMENT_STATUSES = [
  "not_started",
  "awaiting_docs",
  "in_preparation",
  "in_review",
  "awaiting_signature",
  "filed",
  "noa_received",
] as const;

export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const engagement = pgTable(
  "engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    type: engagementType("type").notNull().default("t1"),
    taxYear: integer("tax_year").notNull(),
    status: engagementStatus("status").notNull().default("not_started"),
    // status → ISO timestamp of the moment it was (last) entered.
    statusTimestamps: jsonb("status_timestamps").$type<Record<string, string>>().notNull().default({}),
    // Defaults to the client's assigned accountant at creation; overridable.
    assignedToId: text("assigned_to_id").references(() => staffUser.id),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("engagement_org_status_idx").on(t.orgId, t.status),
    index("engagement_org_client_idx").on(t.orgId, t.clientId),
    index("engagement_org_assigned_idx").on(t.orgId, t.assignedToId),
  ]
);

/** Free-form staff notes on a client; pinned ones surface on the detail header. */
export const clientNote = pgTable(
  "client_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => staffUser.id),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_note_org_client_idx").on(t.orgId, t.clientId)]
);

export const contactChannel = pgEnum("contact_channel", [
  "phone",
  "email",
  "sms",
  "meeting",
  "mail",
  "other",
]);

/** Manual log of touches with a client — drives "last contact" everywhere. */
export const contactLog = pgTable(
  "contact_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    channel: contactChannel("channel").notNull(),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_log_org_client_occurred_idx").on(t.orgId, t.clientId, t.occurredAt)]
);
