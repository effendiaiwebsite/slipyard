import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import { decryptField, encryptField, isValidSin, maskSin } from "@/lib/crypto";
import { can, type Actor } from "@/lib/permissions";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M2 client hub: CRUD through OrgScope, SIN never stored in plaintext,
 * engagement transitions stamp timestamps, meta merging (latest engagement +
 * last contact), accountant scoping, and RLS on the new tables.
 */

const TEST_SIN = "046454286"; // classic fictional test SIN, Luhn-valid

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientId: string;
let engagementId: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  const created = await scopeA.createClient({
    displayName: "Test Client Alpha",
    type: "individual",
    preferredChannel: "phone",
    sinEncrypted: encryptField(TEST_SIN),
    sinLast3: TEST_SIN.slice(-3),
    assignedAccountantId: f.userA,
    tags: ["senior"],
    createdBy: f.userA,
  });
  clientId = created.id;

  const eng = await scopeA.createEngagement({
    clientId,
    type: "t1",
    taxYear: 2025,
    assignedToId: f.userA,
  });
  engagementId = eng.id;
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

describe("SIN handling", () => {
  it("is stored encrypted, never in plaintext, and decrypts round-trip", async () => {
    const c = await scopeA.getClient(clientId);
    expect(c?.sinEncrypted).toBeTruthy();
    expect(c!.sinEncrypted).not.toContain(TEST_SIN);
    expect(c!.sinEncrypted!.startsWith("k1:")).toBe(true);
    expect(decryptField(c!.sinEncrypted!)).toBe(TEST_SIN);
  });

  it("masks to last-3 only", () => {
    expect(maskSin(TEST_SIN)).toBe("*** *** 286");
    expect(isValidSin(TEST_SIN)).toBe(true);
    expect(isValidSin("123456789")).toBe(false);
  });
});

describe("client CRUD via OrgScope", () => {
  it("update + detail reads stay in scope", async () => {
    await scopeA.updateClient(clientId, { city: "Toronto", tags: ["senior", "paper-mail"] });
    const detail = await scopeA.getClientDetail(clientId);
    expect(detail?.client.city).toBe("Toronto");
    expect(detail?.client.tags).toEqual(["senior", "paper-mail"]);
  });

  it("notes and contact log attach to the client", async () => {
    await scopeA.addClientNote({ clientId, body: "Pinned note", pinned: true });
    await scopeA.addContactLog({
      clientId,
      channel: "phone",
      summary: "Called about slips",
      occurredAt: new Date("2026-07-01T12:00:00Z"),
    });
    const detail = await scopeA.getClientDetail(clientId);
    expect(detail?.notes.some((n) => n.note.pinned && n.note.body === "Pinned note")).toBe(true);
    expect(detail?.contacts.some((c) => c.entry.summary === "Called about slips")).toBe(true);
  });

  it("listClientsWithMeta merges latest engagement and last contact", async () => {
    const rows = await scopeA.listClientsWithMeta();
    const row = rows.find((r) => r.client.id === clientId);
    expect(row).toBeTruthy();
    expect(row!.latestEngagement?.id).toBe(engagementId);
    expect(row!.lastContactAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("assignedToId filter narrows to the assignee's book", async () => {
    const mine = await scopeA.listClientsWithMeta({ assignedToId: f.userA });
    expect(mine.some((r) => r.client.id === clientId)).toBe(true);
    const other = await scopeA.listClientsWithMeta({ assignedToId: f.userB });
    expect(other.length).toBe(0);
  });
});

describe("engagement transitions", () => {
  it("sets status and stamps statusTimestamps", async () => {
    const before = Date.now();
    const updated = await scopeA.transitionEngagement(engagementId, "awaiting_docs");
    expect(updated?.status).toBe("awaiting_docs");
    const stamp = updated?.statusTimestamps["awaiting_docs"];
    expect(stamp).toBeTruthy();
    expect(Math.abs(new Date(stamp!).getTime() - before)).toBeLessThan(10_000);
  });

  it("counts by status for dashboards", async () => {
    const counts = await scopeA.countEngagementsByStatus();
    expect(counts.get("awaiting_docs")).toBe(1);
    const forOther = await scopeA.countEngagementsByStatus(f.userB);
    expect(forOther.size).toBe(0);
  });
});

describe("tenant isolation on client-hub tables", () => {
  it("org B's scope sees none of org A's client data", async () => {
    expect(await scopeB.getClient(clientId)).toBeNull();
    expect(await scopeB.getClientDetail(clientId)).toBeNull();
    expect((await scopeB.listClientsWithMeta()).length).toBe(0);
    expect(await scopeB.getEngagement(engagementId)).toBeNull();
    expect((await scopeB.listEngagementsWithMeta()).length).toBe(0);
  });

  it("RLS blocks raw SQL across orgs (app role)", async () => {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      // No org context: nothing visible.
      const none = await c.query(`select * from client where id = $1`, [clientId]);
      expect(none.rowCount).toBe(0);
      // Scoped to org B: org A's client is still invisible despite the filter.
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgB]);
      const cross = await c.query(`select * from client where id = $1`, [clientId]);
      expect(cross.rowCount).toBe(0);
      // WITH CHECK: can't insert a row tagged with another org.
      await expect(
        c.query(
          `insert into client (org_id, display_name) values ($1, 'Smuggled')`,
          [f.orgA]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await c.end();
    }
  });
});

describe("engagement permissions (matrix)", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: "u1", orgId: f.orgA, role });
  const res = (assignedTo: string | null) => ({
    orgId: f.orgA,
    type: "engagement",
    id: "e1",
    assignedTo,
  });

  it("accountant can create/transition only on assigned resources", () => {
    expect(can(actor("accountant"), "engagements.create", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "engagements.create", res("u2"))).toBe(false);
    expect(can(actor("accountant"), "engagements.transition", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "engagements.transition", res(null))).toBe(false);
  });

  it("clerk can never create or transition", () => {
    expect(can(actor("clerk"), "engagements.create", res("u1"))).toBe(false);
    expect(can(actor("clerk"), "engagements.transition", res("u1"))).toBe(false);
  });
});
