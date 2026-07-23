import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { client, engagement } from "./clients";
import { document } from "./documents";
import { org } from "./tenancy";

/**
 * E-signature (M6). Tenant table — org_id + FORCEd RLS
 * (drizzle/0020_m6_rls.sql).
 *
 * A signature_request is a single-signer envelope: one client signs one source
 * PDF (T183-style). Staff place fields on the PDF (normalised coords, ADR-0025),
 * send it, and the signer executes it either REMOTELY through the portal
 * session (scope 'sign', ADR-0026) or IN PERSON on a staff device. Executing
 * stamps the signature + a CRA timestamp + an appended audit page into a NEW,
 * immutable object (source='esign_executed', ADR-0027) — the original is never
 * touched. All the facts the audit page needs (who/when/IP/method/token id/
 * source hash) live on the row.
 *
 * Multiple signers (e.g. spouses) = multiple requests, one per client.
 */

export const signatureRequestMode = pgEnum("signature_request_mode", ["remote", "in_person"]);

export const signatureRequestStatus = pgEnum("signature_request_status", [
  "draft", // staff still placing fields / not sent
  "sent", // delivered to the signer, awaiting action
  "viewed", // signer opened the signing surface
  "signed", // executed — signed_document_id points at the stamped PDF
  "declined", // signer declined
  "canceled", // staff withdrew before signing
]);

/** How the signer produced their mark. Recorded on the audit page. */
export const signatureMethod = pgEnum("signature_method", ["drawn", "typed"]);

/** One placed field. Coordinates are fractions of the page (top-left origin),
 *  so they survive any display scaling and convert to pdf-lib's bottom-left
 *  origin at stamp time. */
export type FieldPlacement = {
  id: string;
  /** 0-based page index. */
  page: number;
  /** All 0..1, relative to the page box. */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  kind: "signature" | "initials" | "date";
};

export const signatureRequest = pgTable(
  "signature_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    /** The source PDF being signed — a clean vault document. */
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "restrict" }),
    /** Optional context: drives "out for signature" engagement advancement. */
    engagementId: uuid("engagement_id").references(() => engagement.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    mode: signatureRequestMode("mode").notNull().default("remote"),
    status: signatureRequestStatus("status").notNull().default("draft"),
    /** Snapshot of who signs + how we reach them (survives client edits). */
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email"),
    signerPhone: text("signer_phone"),
    /** Placed fields (ADR-0025). */
    placements: jsonb("placements").$type<FieldPlacement[]>().notNull().default([]),
    /** sha256 of the SOURCE PDF bytes at send time — tamper evidence, on the audit page. */
    sourceHash: text("source_hash"),
    /** The executed, immutable PDF (source='esign_executed'). */
    signedDocumentId: uuid("signed_document_id").references(() => document.id, {
      onDelete: "set null",
    }),
    /** sha256 of the executed PDF bytes. */
    signedHash: text("signed_hash"),
    signatureMethod: signatureMethod("signature_method"),
    /** 'portal' (remote) or 'in_person'. */
    signedVia: text("signed_via"),
    /** IP captured at execution — on the audit page. */
    signedIp: text("signed_ip"),
    /** For remote: the portal_token id whose OTP authenticated the signer. */
    signedTokenId: uuid("signed_token_id"),
    /** For in-person: the staff user who operated the device. */
    signedByStaffId: text("signed_by_staff_id").references(() => staffUser.id),
    declineReason: text("decline_reason"),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("signature_request_org_client_idx").on(t.orgId, t.clientId),
    index("signature_request_org_status_idx").on(t.orgId, t.status),
    index("signature_request_org_engagement_idx").on(t.orgId, t.engagementId),
  ]
);
