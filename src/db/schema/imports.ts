import {
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
import { client } from "./clients";
import { org } from "./tenancy";

/**
 * Generic data import (M9, ADR-0033). All tenant tables — org_id + FORCEd RLS
 * (drizzle/0026_m9_rls.sql).
 *
 * The wizard lets a firm bulk-load a messy CSV onto clients + per-firm custom
 * fields. A batch is the unit of work AND the unit of rollback: staging rows
 * record exactly what was parsed and (after commit) which client each one
 * created, so a batch can be undone by deleting precisely those rows.
 *
 * SIN NEVER LANDS IN STAGING AS PLAINTEXT (iron rule). When a column is mapped
 * to `sin`, the staging projection stores only the AES-256-GCM ciphertext +
 * the last-3 mask (mirrors the client table), and the raw snapshot masks that
 * cell. The plaintext exists transiently in the staging server action's memory
 * and is encrypted before any row is written.
 */

/** What a batch imports. Extensible; only clients for M9. */
export const importKind = pgEnum("import_kind", ["clients"]);

/**
 * Batch lifecycle:
 *  staged                 — rows parsed, validated, awaiting commit
 *  committed              — client rows created; created_client_id set
 *  rolled_back            — every created client removed (clean restore)
 *  partially_rolled_back  — some created clients were kept (they had gained
 *                           engagements/docs/notes since import — ADR-0033)
 */
export const importStatus = pgEnum("import_status", [
  "staged",
  "committed",
  "rolled_back",
  "partially_rolled_back",
]);

/** Per-row disposition decided at staging time. */
export const importRowAction = pgEnum("import_row_action", ["create", "skip"]);

export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    kind: importKind("kind").notNull().default("clients"),
    status: importStatus("status").notNull().default("staged"),
    /** Original CSV filename (sanitized display) or "Pasted CSV". */
    filename: text("filename").notNull(),
    /** Detected column headers, in source order. */
    sourceColumns: text("source_columns").array().notNull().default([]),
    /** Snapshot of the source-column → target-field mapping used to stage. */
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    rowCount: integer("row_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_batch_org_created_idx").on(t.orgId, t.createdAt)]
);

export const importStagingRow = pgTable(
  "import_staging_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatch.id, { onDelete: "cascade" }),
    /** 1-based source data-row number (excludes the header row). */
    rowNumber: integer("row_number").notNull(),
    /** Source cells keyed by column header. SIN-mapped cell is masked here. */
    raw: jsonb("raw").$type<Record<string, string>>().notNull().default({}),
    /**
     * Normalised target values keyed by target-field key. `sin` never appears;
     * instead `sinEncrypted`/`sinLast3` carry the encrypted form (ADR-0033).
     */
    mapped: jsonb("mapped").$type<Record<string, unknown>>().notNull().default({}),
    warnings: text("warnings").array().notNull().default([]),
    action: importRowAction("action").notNull().default("create"),
    /** Set at commit — the client this row created; drives rollback. */
    createdClientId: uuid("created_client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_staging_row_org_batch_idx").on(t.orgId, t.batchId, t.rowNumber)]
);

/** A reusable source-header → target-field mapping a firm saves. */
export const importMappingTemplate = pgTable(
  "import_mapping_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: importKind("kind").notNull().default("clients"),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_mapping_template_org_name_uq").on(t.orgId, t.name)]
);

export type ImportBatch = typeof importBatch.$inferSelect;
export type ImportStagingRow = typeof importStagingRow.$inferSelect;
export type ImportMappingTemplate = typeof importMappingTemplate.$inferSelect;
