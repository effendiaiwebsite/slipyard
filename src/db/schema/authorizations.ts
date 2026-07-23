import { date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { client } from "./clients";
import { org } from "./tenancy";

/**
 * CRA authorization tracking (M7). Tenant table — org_id + FORCEd RLS
 * (drizzle/0022_m7_rls.sql).
 *
 * One row per authorization the firm holds (or is obtaining) with the CRA for
 * a client — T1013/AuthRep-a-Client for individuals, RC59-style business
 * authorization for corporations/trusts. This CRM tracks the paperwork state
 * BESIDE the firm's EFILE software; it never talks to the CRA itself.
 *
 * `status` is what staff recorded; the EFFECTIVE state also derives expiry
 * (an 'active' row past its expiry_date counts as expired — see
 * src/lib/authorizations.ts, ADR-0028). Records are corrected in place or
 * revoked; coverage always reads the client's best current row.
 */

/** CRA access levels: 1 = view info, 2 = view + request changes,
 *  3 = delegate authority (business accounts). */
export const authorizationLevel = pgEnum("authorization_level", ["level1", "level2", "level3"]);

export const authorizationStatus = pgEnum("authorization_status", [
  "pending", // submitted / awaiting CRA confirmation
  "active", // confirmed by the CRA
  "expired", // explicitly marked (derived automatically from expiry_date too)
  "revoked", // withdrawn by the client or the firm
]);

export const craAuthorization = pgTable(
  "cra_authorization",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    level: authorizationLevel("level").notNull().default("level1"),
    status: authorizationStatus("status").notNull().default("pending"),
    /** CRA authorizations have no expiry unless the client set one. */
    expiryDate: date("expiry_date"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cra_authorization_org_client_idx").on(t.orgId, t.clientId),
    index("cra_authorization_org_status_idx").on(t.orgId, t.status),
  ]
);
