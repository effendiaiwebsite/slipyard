import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { encryptField } from "../src/lib/crypto";
import * as schema from "../src/db/schema";
import { DEFAULT_ENGAGEMENT_STAGES } from "../src/db/schema";
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
  households: {
    desjardins: "eeeeeee1-0000-4000-8000-000000000001",
    nguyen: "eeeeeee1-0000-4000-8000-000000000002",
  },
  clients: {
    marc: "ccccccc1-0000-4000-8000-000000000001",
    helene: "ccccccc1-0000-4000-8000-000000000002",
    an: "ccccccc1-0000-4000-8000-000000000003",
    linh: "ccccccc1-0000-4000-8000-000000000004",
    ruth: "ccccccc1-0000-4000-8000-000000000005",
    sofia: "ccccccc1-0000-4000-8000-000000000006",
    dmitri: "ccccccc1-0000-4000-8000-000000000007",
    gordon: "ccccccc1-0000-4000-8000-000000000008", // archived
    pinesBirch: "ccccccc1-0000-4000-8000-000000000009", // corporation
    blackwoodTrust: "ccccccc1-0000-4000-8000-00000000000a", // trust
    northClient: "ddddddd2-0000-4000-8000-000000000001", // org 2 (isolation)
  },
  password: "demo-password-123",
} as const;

// Fictional but Luhn-valid (isValidSin) — the classic CRA test SIN and one
// computed for the seed. NEVER real SINs.
const TEST_SINS = { marc: "046454286", an: "123456782" } as const;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Never seed production");

  const pool = new Pool({ connectionString: adminUrl(APP_DB_NAME) });
  const db = drizzle(pool, { schema });

  // Wipe in FK order. TRUNCATE ... CASCADE keeps this list forgiving.
  await pool.query(
    `truncate table contact_log, client_note, engagement, engagement_stage,
     client, household, audit_log, invitation, org_membership, auth_two_factor,
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

  // ---- M2: workflow stages (default template per org, deterministic ids) ----

  const stageId = (orgN: 1 | 2, position: number) =>
    `ee${orgN}00000-0000-4000-8000-00000000000${position + 1}`;
  const stageIdsByKey: Record<1 | 2, Record<string, string>> = { 1: {}, 2: {} };
  for (const orgN of [1, 2] as const) {
    await db.insert(schema.engagementStage).values(
      DEFAULT_ENGAGEMENT_STAGES.map((s) => {
        const id = stageId(orgN, s.position);
        stageIdsByKey[orgN][s.key] = id;
        return { id, orgId: orgN === 1 ? SEED.org1 : SEED.org2, ...s };
      })
    );
  }
  const stage1 = stageIdsByKey[1];

  // ---- M2: households, clients, engagements, notes, contact log -------------

  await db.insert(schema.household).values([
    { id: SEED.households.desjardins, orgId: SEED.org1, name: "Desjardins household" },
    { id: SEED.households.nguyen, orgId: SEED.org1, name: "Nguyen household" },
  ]);

  const c = SEED.clients;
  const u = SEED.users;
  await db.insert(schema.client).values([
    {
      id: c.marc,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Marc Desjardins",
      email: "marc.desjardins@example.test",
      phone: "+14165550101",
      preferredChannel: "phone",
      addressLine1: "12 Bayview Cres",
      city: "Toronto",
      province: "ON",
      postalCode: "M4E 1A1",
      dateOfBirth: "1948-03-14",
      sinEncrypted: encryptField(TEST_SINS.marc),
      sinLast3: TEST_SINS.marc.slice(-3),
      assignedAccountantId: u.sam,
      householdId: SEED.households.desjardins,
      tags: ["senior", "paper-mail"],
      createdBy: u.joey,
    },
    {
      id: c.helene,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Hélène Desjardins",
      phone: "+14165550102",
      preferredChannel: "phone",
      addressLine1: "12 Bayview Cres",
      city: "Toronto",
      province: "ON",
      postalCode: "M4E 1A1",
      dateOfBirth: "1951-09-02",
      assignedAccountantId: u.sam,
      householdId: SEED.households.desjardins,
      tags: ["senior"],
      createdBy: u.joey,
    },
    {
      id: c.an,
      orgId: SEED.org1,
      type: "individual",
      displayName: "An Nguyen",
      email: "an.nguyen@example.test",
      phone: "+14165550103",
      preferredChannel: "email",
      city: "Scarborough",
      province: "ON",
      dateOfBirth: "1975-11-30",
      sinEncrypted: encryptField(TEST_SINS.an),
      sinLast3: TEST_SINS.an.slice(-3),
      assignedAccountantId: u.joey,
      householdId: SEED.households.nguyen,
      tags: ["self-employed"],
      customFields: { "Business type": "Sole proprietor — catering" },
      createdBy: u.maria,
    },
    {
      id: c.linh,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Linh Nguyen",
      email: "linh.nguyen@example.test",
      preferredChannel: "sms",
      phone: "+14165550104",
      city: "Scarborough",
      province: "ON",
      assignedAccountantId: u.joey,
      householdId: SEED.households.nguyen,
      createdBy: u.maria,
    },
    {
      id: c.ruth,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Ruth Okafor",
      email: "ruth.okafor@example.test",
      preferredChannel: "email",
      city: "North York",
      province: "ON",
      assignedAccountantId: u.sam,
      tags: ["new-client"],
      createdBy: u.joey,
    },
    {
      id: c.sofia,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Sofia Marinov",
      phone: "+14165550106",
      preferredChannel: "phone",
      city: "Etobicoke",
      province: "ON",
      tags: ["senior"],
      createdBy: u.joey, // deliberately unassigned
    },
    {
      id: c.dmitri,
      orgId: SEED.org1,
      type: "individual",
      displayName: "Dmitri Volkov",
      email: "d.volkov@example.test",
      preferredChannel: "email",
      city: "Mississauga",
      province: "ON",
      tags: ["prospect"],
      createdBy: u.maria, // no engagement yet
    },
    {
      id: c.gordon,
      orgId: SEED.org1,
      type: "individual",
      status: "archived",
      displayName: "Gordon Blackwood",
      city: "Toronto",
      province: "ON",
      tags: ["deceased-estate"],
      createdBy: u.joey,
    },
    {
      id: c.pinesBirch,
      orgId: SEED.org1,
      type: "corporation",
      displayName: "Pines & Birch Landscaping Ltd.",
      email: "office@pinesbirch.example.test",
      preferredChannel: "email",
      city: "Vaughan",
      province: "ON",
      assignedAccountantId: u.sam,
      tags: ["corporate"],
      customFields: { "Year-end": "September 30" },
      createdBy: u.joey,
    },
    {
      id: c.blackwoodTrust,
      orgId: SEED.org1,
      type: "trust",
      displayName: "Blackwood Family Trust",
      preferredChannel: "mail",
      city: "Toronto",
      province: "ON",
      assignedAccountantId: u.joey,
      tags: ["estate"],
      createdBy: u.joey,
    },
    // Org 2 — proves isolation; must never appear in Lakeside queries.
    {
      id: c.northClient,
      orgId: SEED.org2,
      type: "individual",
      displayName: "Wendy Moosomin",
      preferredChannel: "phone",
      city: "Winnipeg",
      province: "MB",
      assignedAccountantId: u.northOwner,
      createdBy: u.northOwner,
    },
  ]);

  // Engagements: 2025 tax year spread across the whole pipeline so the
  // workflow board has every column populated.
  const eng = (n: number) => `abcabca1-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
  const ts = (stageKey: string, iso: string) => ({ [stageKey]: iso });
  await db.insert(schema.engagement).values([
    { id: eng(1), orgId: SEED.org1, clientId: c.marc, type: "t1", taxYear: 2025, stageId: stage1.noa_received, assignedToId: u.sam, createdBy: u.joey, statusTimestamps: ts("noa_received", "2026-05-20T15:00:00Z") },
    { id: eng(2), orgId: SEED.org1, clientId: c.helene, type: "t1", taxYear: 2025, stageId: stage1.filed, assignedToId: u.sam, createdBy: u.joey, statusTimestamps: ts("filed", "2026-04-28T19:30:00Z") },
    { id: eng(3), orgId: SEED.org1, clientId: c.an, type: "t1", taxYear: 2025, stageId: stage1.in_review, assignedToId: u.joey, createdBy: u.maria, statusTimestamps: ts("in_review", "2026-07-08T13:00:00Z") },
    { id: eng(4), orgId: SEED.org1, clientId: c.linh, type: "t1", taxYear: 2025, stageId: stage1.awaiting_signature, assignedToId: u.joey, createdBy: u.maria, statusTimestamps: ts("awaiting_signature", "2026-07-15T17:00:00Z") },
    { id: eng(5), orgId: SEED.org1, clientId: c.ruth, type: "t1", taxYear: 2025, stageId: stage1.awaiting_docs, assignedToId: u.sam, createdBy: u.joey, statusTimestamps: ts("awaiting_docs", "2026-06-30T14:00:00Z") },
    { id: eng(6), orgId: SEED.org1, clientId: c.sofia, type: "t1", taxYear: 2025, stageId: stage1.not_started, createdBy: u.joey },
    { id: eng(7), orgId: SEED.org1, clientId: c.pinesBirch, type: "t2", taxYear: 2025, stageId: stage1.in_preparation, assignedToId: u.sam, createdBy: u.joey, statusTimestamps: ts("in_preparation", "2026-07-02T16:00:00Z") },
    { id: eng(8), orgId: SEED.org1, clientId: c.blackwoodTrust, type: "t3", taxYear: 2025, stageId: stage1.in_preparation, assignedToId: u.joey, createdBy: u.joey, statusTimestamps: ts("in_preparation", "2026-06-20T16:00:00Z") },
    { id: eng(9), orgId: SEED.org2, clientId: c.northClient, type: "t1", taxYear: 2025, stageId: stageIdsByKey[2].awaiting_docs, assignedToId: u.northOwner, createdBy: u.northOwner },
  ]);

  await db.insert(schema.clientNote).values([
    { orgId: SEED.org1, clientId: c.marc, authorId: u.sam, pinned: true, body: "Hard of hearing — call his daughter Claire first (+1 416 555 0199). Prefers paper copies mailed." },
    { orgId: SEED.org1, clientId: c.marc, authorId: u.priya, body: "Dropped off a folder of slips at reception, includes T5s from two banks." },
    { orgId: SEED.org1, clientId: c.an, authorId: u.joey, pinned: true, body: "Catering business — HST return quarterly. Ask about vehicle logbook every year." },
    { orgId: SEED.org1, clientId: c.ruth, authorId: u.sam, body: "New client this year, referred by An Nguyen. Still waiting on prior-year NOA copy." },
  ]);

  await db.insert(schema.contactLog).values([
    { orgId: SEED.org1, clientId: c.marc, channel: "phone", summary: "Called re: NOA received — refund deposited. He'll pick up his paper copy Thursday.", occurredAt: new Date("2026-05-22T14:30:00Z"), createdBy: u.sam },
    { orgId: SEED.org1, clientId: c.ruth, channel: "email", summary: "Emailed reminder for the missing prior-year NOA and daycare receipts.", occurredAt: new Date("2026-07-06T15:00:00Z"), createdBy: u.sam },
    { orgId: SEED.org1, clientId: c.linh, channel: "sms", summary: "Texted: return ready for signature, offered in-office or portal signing.", occurredAt: new Date("2026-07-15T17:05:00Z"), createdBy: u.maria },
    { orgId: SEED.org1, clientId: c.pinesBirch, channel: "meeting", summary: "Year-end planning meeting with owners; new truck purchase — CCA discussion.", occurredAt: new Date("2026-07-10T18:00:00Z"), createdBy: u.sam },
  ]);

  await db.insert(schema.auditLog).values({
    orgId: SEED.org1,
    actorType: "system",
    action: "seed.applied",
    resourceType: "org",
    resourceId: SEED.org1,
    details: { note: "deterministic dev seed" },
  });

  await pool.end();

  console.log("Seeded 2 orgs, 5 staff users, 11 clients, 9 engagements.");
  console.log("Dev logins (all password: %s):", SEED.password);
  for (const s of staff) console.log(`  ${s.role.padEnd(10)} ${s.email}  (${s.orgId === SEED.org1 ? "Lakeside CPA" : "Northern Tax"})`);
  console.log("First login will require TOTP enrollment (mandatory 2FA).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
