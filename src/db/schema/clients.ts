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
  uniqueIndex,
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
 * Workflow pipeline (ADR-0013, per-org customizable since ADR-0015).
 * Firms rename/add/remove/reorder STAGES; every stage carries a fixed
 * CATEGORY that automations (M3 checklists, M5 reminders, M6 signing)
 * hook onto — so customization never breaks downstream behavior.
 */
export const stageCategory = pgEnum("stage_category", [
  "not_started",
  "awaiting_docs",
  "in_progress",
  "awaiting_signature",
  "filed",
  "complete",
]);

export const STAGE_CATEGORIES = [
  "not_started",
  "awaiting_docs",
  "in_progress",
  "awaiting_signature",
  "filed",
  "complete",
] as const;

export type StageCategory = (typeof STAGE_CATEGORIES)[number];

/**
 * The template every new org starts from (org bootstrap, seed, and the
 * 0008 backfill all use this). Keys are immutable slugs — renames change
 * the label only, so status_timestamps history stays readable.
 */
export const DEFAULT_ENGAGEMENT_STAGES: ReadonlyArray<{
  key: string;
  label: string;
  category: StageCategory;
  position: number;
}> = [
  { key: "not_started", label: "Not started", category: "not_started", position: 0 },
  { key: "awaiting_docs", label: "Awaiting docs", category: "awaiting_docs", position: 1 },
  { key: "in_preparation", label: "In preparation", category: "in_progress", position: 2 },
  { key: "in_review", label: "In review", category: "in_progress", position: 3 },
  { key: "awaiting_signature", label: "Awaiting signature", category: "awaiting_signature", position: 4 },
  { key: "filed", label: "Filed", category: "filed", position: 5 },
  { key: "noa_received", label: "NOA received", category: "complete", position: 6 },
];

export const engagementStage = pgTable(
  "engagement_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    // Immutable slug (from the label at creation); rename touches label only.
    key: text("key").notNull(),
    label: text("label").notNull(),
    category: stageCategory("category").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("engagement_stage_org_key_uq").on(t.orgId, t.key),
    index("engagement_stage_org_position_idx").on(t.orgId, t.position),
  ]
);

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
    // Any→any transitions (ADR-0013); deletion of an in-use stage is
    // blocked (restrict) — the UI reassigns engagements first.
    stageId: uuid("stage_id")
      .notNull()
      .references(() => engagementStage.id, { onDelete: "restrict" }),
    // stage KEY → ISO timestamp of the moment it was (last) entered.
    statusTimestamps: jsonb("status_timestamps").$type<Record<string, string>>().notNull().default({}),
    // Defaults to the client's assigned accountant at creation; overridable.
    assignedToId: text("assigned_to_id").references(() => staffUser.id),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("engagement_org_stage_idx").on(t.orgId, t.stageId),
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
