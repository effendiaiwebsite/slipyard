import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { client, engagement } from "./clients";
import { org } from "./tenancy";

/**
 * Vault & checklists (M3). All tenant tables — org_id + FORCEd RLS
 * (drizzle/0012_m3_rls.sql).
 *
 * Document lifecycle: uploaded bytes land at org/{orgId}/quarantine/{id}/
 * (status pending_scan), ClamAV scans them, then the object is promoted to
 * org/{orgId}/vault/{id}/ (clean) or left quarantined (infected /
 * scan_failed — never downloadable, retry allowed for scan_failed).
 * s3_key always points at the CURRENT object location.
 */

export const documentStatus = pgEnum("document_status", [
  "pending_scan",
  "clean",
  "infected",
  "scan_failed",
]);

/** Who put the bytes in: staff via the CRM, the client portal (M4), or the
 *  e-signature engine's stamped output (M6 — generated internally, never
 *  scanned, lives under org/{orgId}/signed/). */
export const documentSource = pgEnum("document_source", [
  "staff_upload",
  "portal_upload",
  "esign_executed",
]);

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    // Optional until the doc is filed against a specific return.
    engagementId: uuid("engagement_id").references(() => engagement.id, { onDelete: "set null" }),
    // Original name, sanitized for display + the S3 key tail. Never trusted as a path.
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    s3Key: text("s3_key").notNull(),
    status: documentStatus("status").notNull().default("pending_scan"),
    // Virus/engine name for infected, error summary for scan_failed; null when clean.
    scanResult: text("scan_result"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    source: documentSource("source").notNull().default("staff_upload"),
    uploadedBy: text("uploaded_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_org_client_idx").on(t.orgId, t.clientId),
    index("document_org_engagement_idx").on(t.orgId, t.engagementId),
    index("document_org_status_idx").on(t.orgId, t.status),
  ]
);

export const checklistItemStatus = pgEnum("checklist_item_status", [
  "missing",
  "received",
  "waived",
]);

/**
 * Per-engagement document checklist, instantiated from the engagement-type
 * template (src/lib/checklists.ts) and editable per engagement. State
 * changes drive the auto-advance rules — which key on stage CATEGORY only
 * (ADR-0015), never on stage keys or labels.
 */
export const checklistItem = pgTable(
  "checklist_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagement.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    required: boolean("required").notNull().default(true),
    status: checklistItemStatus("status").notNull().default("missing"),
    // The document that satisfied this item, when one did (manual receipt —
    // e.g. paper handed over at the desk — leaves this null).
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("checklist_item_org_engagement_idx").on(t.orgId, t.engagementId),
    index("checklist_item_org_document_idx").on(t.orgId, t.documentId),
  ]
);
