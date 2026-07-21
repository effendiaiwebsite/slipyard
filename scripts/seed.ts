import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { adminUrl, APP_DB_NAME } from "./db-lib";

/**
 * Deterministic, fictional seed data (§8). NO real client data, ever.
 * Runs as the DB owner (bypasses RLS by design — it seeds multiple orgs).
 * Destructive: wipes and re-creates all seed rows. Dev/test only.
 *
 * Fixed UUIDs so tests can reference them:
 *   Org 1 Lakeside CPA      11111111-....  full demo org
 *   Org 2 Northern Tax      22222222-....  exists to prove isolation
 *
 * M0 scope: orgs, staff, memberships, one audit entry. Clients/engagements/
 * documents arrive with their milestones (M2/M3) and extend this file.
 */

export const SEED = {
  org1: "11111111-1111-4111-8111-111111111111",
  org2: "22222222-2222-4222-8222-222222222222",
  users: {
    joey: "aaaaaaa1-0000-4000-8000-000000000001",
    maria: "aaaaaaa1-0000-4000-8000-000000000002",
    sam: "aaaaaaa1-0000-4000-8000-000000000003",
    priya: "aaaaaaa1-0000-4000-8000-000000000004",
    northOwner: "bbbbbbb2-0000-4000-8000-000000000001",
  },
  password: "demo-password-123",
} as const;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Never seed production");

  const pool = new Pool({ connectionString: adminUrl(APP_DB_NAME) });
  const db = drizzle(pool, { schema });

  // Wipe in FK order. TRUNCATE ... CASCADE keeps this list forgiving.
  await pool.query(
    `truncate table audit_log, invitation, org_membership, auth_two_factor,
     auth_verification, auth_account, auth_session, staff_user, org cascade`
  );

  await db.insert(schema.org).values([
    { id: SEED.org1, name: "Lakeside CPA", timezone: "America/Toronto" },
    { id: SEED.org2, name: "Northern Tax Partners", timezone: "America/Winnipeg" },
  ]);

  const staff: Array<{
    id: string;
    name: string;
    email: string;
    orgId: string;
    role: "owner" | "admin" | "accountant" | "clerk";
  }> = [
    { id: SEED.users.joey, name: "Joey Tremblay", email: "joey@lakesidecpa.test", orgId: SEED.org1, role: "owner" },
    { id: SEED.users.maria, name: "Maria Kalinowski", email: "maria@lakesidecpa.test", orgId: SEED.org1, role: "admin" },
    { id: SEED.users.sam, name: "Sam Osei", email: "sam@lakesidecpa.test", orgId: SEED.org1, role: "accountant" },
    { id: SEED.users.priya, name: "Priya Patel", email: "priya@lakesidecpa.test", orgId: SEED.org1, role: "clerk" },
    { id: SEED.users.northOwner, name: "Nina Chartrand", email: "nina@northerntax.test", orgId: SEED.org2, role: "owner" },
  ];

  const passwordHash = await hashPassword(SEED.password);

  for (const s of staff) {
    await db.insert(schema.staffUser).values({
      id: s.id,
      name: s.name,
      email: s.email,
      emailVerified: true,
    });
    // better-auth credential account (providerId 'credential').
    await db.insert(schema.authAccount).values({
      id: `acct-${s.id}`,
      accountId: s.id,
      providerId: "credential",
      userId: s.id,
      password: passwordHash,
    });
    await db.insert(schema.orgMembership).values({
      orgId: s.orgId,
      userId: s.id,
      role: s.role,
      status: "active",
    });
  }

  await db.insert(schema.auditLog).values({
    orgId: SEED.org1,
    actorType: "system",
    action: "seed.applied",
    resourceType: "org",
    resourceId: SEED.org1,
    details: { note: "deterministic dev seed" },
  });

  await pool.end();

  console.log("Seeded 2 orgs, 5 staff users.");
  console.log("Dev logins (all password: %s):", SEED.password);
  for (const s of staff) console.log(`  ${s.role.padEnd(10)} ${s.email}  (${s.orgId === SEED.org1 ? "Lakeside CPA" : "Northern Tax"})`);
  console.log("First login will require TOTP enrollment (mandatory 2FA).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
