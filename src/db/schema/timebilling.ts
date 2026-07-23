import {
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
import { client, engagement } from "./clients";
import { org } from "./tenancy";

/**
 * Time & billing, basic (M7). Tenant tables — org_id + FORCEd RLS
 * (drizzle/0022_m7_rls.sql).
 *
 * All money is integer CENTS (CAD) — no floats anywhere near an invoice.
 * time_entry rows with invoice_id null are the firm's WIP; invoicing
 * snapshots them into the invoice's `lines` jsonb and stamps invoice_id, so
 * later edits to entries never change an issued invoice (ADR-0030). Voiding
 * an invoice releases its entries back to WIP.
 */

/** One line on an invoice — a snapshot taken at creation time. */
export type InvoiceLine = {
  description: string;
  minutes: number;
  rateCents: number;
  amountCents: number;
  /** The time entry this line came from (traceability only). */
  timeEntryId?: string;
};

export const invoiceStatus = pgEnum("invoice_status", ["draft", "sent", "paid", "void"]);

export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    /** Per-org sequence starting at 1 — displayed as INV-0001. */
    number: integer("number").notNull(),
    status: invoiceStatus("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull().default([]),
    subtotalCents: integer("subtotal_cents").notNull(),
    /** e.g. "HST (13%)" — what the PDF prints beside the tax amount. */
    taxLabel: text("tax_label").notNull(),
    /** Basis points (1300 = 13%) — kept for recomputation/reporting. */
    taxRateBps: integer("tax_rate_bps").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoice_org_number_uq").on(t.orgId, t.number),
    index("invoice_org_client_idx").on(t.orgId, t.clientId),
    index("invoice_org_status_idx").on(t.orgId, t.status),
  ]
);

export const timeEntry = pgTable(
  "time_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").references(() => engagement.id, { onDelete: "set null" }),
    /** Who did the work (not necessarily who typed it in — that's created_by). */
    userId: text("user_id")
      .notNull()
      .references(() => staffUser.id),
    workDate: date("work_date").notNull(),
    minutes: integer("minutes").notNull(),
    description: text("description").notNull(),
    /** Hourly rate snapshot at entry time (org default, editable per entry). */
    rateCents: integer("rate_cents").notNull(),
    /** Null = unbilled WIP; set when the entry lands on an invoice. */
    invoiceId: uuid("invoice_id").references(() => invoice.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("time_entry_org_client_idx").on(t.orgId, t.clientId),
    index("time_entry_org_invoice_idx").on(t.orgId, t.invoiceId),
    index("time_entry_org_user_date_idx").on(t.orgId, t.userId, t.workDate),
  ]
);
