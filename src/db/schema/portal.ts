import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { client } from "./clients";
import { org } from "./tenancy";

/**
 * Client portal access (M4). Firm clients NEVER get auth accounts (ADR-0001)
 * — access is a magic-link JWT whose sha256 hash lives here (ADR-0003), plus
 * a 6-digit SMS OTP challenge tracked on the same row.
 *
 * Lifecycle: staff issue a link (expires_at = now + 7 days) → client opens it
 * (opened_at set; the LINK dies 15 minutes later) → OTP sent to
 * recipient_phone → verified (verified_at) → short-lived signed portal
 * session cookie takes over. Revocation (revoked_at) kills the link AND any
 * live session, which re-checks this row on every request.
 *
 * Trusted helpers: a link may be addressed to someone the client trusts
 * (adult child, caregiver — is_helper + recipient fields). include_household
 * widens read/upload scope to every client in the same household.
 */
export const portalToken = pgTable(
  "portal_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    // sha256 of the raw magic-link token; the raw JWT exists only in the sent
    // link (ADR-0003). Unique so a hash lookup is exact.
    tokenHash: text("token_hash").notNull().unique(),
    // Who the link is addressed to — the client themselves or a trusted helper.
    recipientName: text("recipient_name").notNull(),
    // E.164; the SMS OTP goes here. May differ from client.phone for helpers.
    recipientPhone: text("recipient_phone").notNull(),
    isHelper: boolean("is_helper").notNull().default(false),
    // Display-only context, e.g. "daughter" — never used for authorization.
    helperRelationship: text("helper_relationship"),
    // Widens scope to all clients sharing the client's household.
    includeHousehold: boolean("include_household").notNull().default(false),
    // Capability scopes embedded in the JWT and re-checked per request.
    // M4: 'view' + 'upload'. M6 adds 'sign'.
    scopes: text("scopes").array().notNull().default(["view", "upload"]),
    // Unopened links last 7 days...
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // ...but die 15 minutes after first open (portal-tokens.ts enforces).
    openedAt: timestamp("opened_at", { withTimezone: true }),
    // Current OTP challenge: sha256(code + token id), 10-minute window,
    // max 5 wrong attempts before the whole link is dead.
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => staffUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_token_org_client_idx").on(t.orgId, t.clientId)]
);

/** Scopes a portal token may carry. */
export const PORTAL_SCOPES = ["view", "upload", "sign"] as const;
export type PortalScope = (typeof PORTAL_SCOPES)[number];
