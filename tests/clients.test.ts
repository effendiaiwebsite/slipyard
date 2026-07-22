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
let stageIds: Record<string, string>; // org A: template key → id

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  // Fixture orgs are created raw (no bootstrap), so give org A the default
  // stage template through the scoped layer.
  stageIds = {};
  const { DEFAULT_ENGAGEMENT_STAGES } = await import("@/db/schema");
  for (const s of DEFAULT_ENGAGEMENT_STAGES) {
    const row = await scopeA.createStage({ key: s.key, label: s.label, category: s.category });
    stageIds[s.key] = row.id;
  }

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
    stageId: stageIds.not_started,
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
    expect(row!.latestEngagement?.engagement.id).toBe(engagementId);
    expect(row!.latestEngagement?.stage.key).toBe("not_started");
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
  it("moves to the stage and stamps statusTimestamps by stage key", async () => {
    const before = Date.now();
    const updated = await scopeA.transitionEngagement(engagementId, stageIds.awaiting_docs);
    expect(updated?.stageId).toBe(stageIds.awaiting_docs);
    const stamp = updated?.statusTimestamps["awaiting_docs"];
    expect(stamp).toBeTruthy();
    expect(Math.abs(new Date(stamp!).getTime() - before)).toBeLessThan(10_000);
  });

  it("rejects a stage from another org", async () => {
    const foreign = await scopeB.createStage({
      key: "b-stage",
      label: "B stage",
      category: "in_progress",
    });
    // Org A's transition can't resolve org B's stage — scoped lookup misses.
    expect(await scopeA.transitionEngagement(engagementId, foreign.id)).toBeNull();
  });

  it("counts by stage for dashboards", async () => {
    const counts = await scopeA.countEngagementsByStage();
    expect(counts.get(stageIds.awaiting_docs)).toBe(1);
    const forOther = await scopeA.countEngagementsByStage(f.userB);
    expect(forOther.size).toBe(0);
  });
});

describe("stage management (ADR-0015)", () => {
  it("renames a stage without touching its key", async () => {
    const updated = await scopeA.updateStage(stageIds.in_review, { label: "Partner review" });
    expect(updated?.label).toBe("Partner review");
    expect(updated?.key).toBe("in_review");
  });

  it("appends new stages at the end and reorders", async () => {
    const added = await scopeA.createStage({
      key: "efile-queue",
      label: "EFILE queue",
      category: "in_progress",
    });
    let stages = await scopeA.listStages();
    expect(stages[stages.length - 1].id).toBe(added.id);

    const order = stages.map((s) => s.id);
    [order[order.length - 1], order[order.length - 2]] = [
      order[order.length - 2],
      order[order.length - 1],
    ];
    await scopeA.setStagePositions(order);
    stages = await scopeA.listStages();
    expect(stages[stages.length - 2].id).toBe(added.id);
  });

  it("delete of an in-use stage requires reassignment, then moves engagements", async () => {
    expect(await scopeA.deleteStage(stageIds.awaiting_docs)).toBe("in_use");
    expect(await scopeA.deleteStage(stageIds.awaiting_docs, stageIds.in_preparation)).toBe("ok");
    const eng = await scopeA.getEngagement(engagementId);
    expect(eng?.stageId).toBe(stageIds.in_preparation);
  });

  it("stages are tenant-isolated", async () => {
    const bStages = await scopeB.listStages();
    expect(bStages.every((s) => s.orgId === f.orgB)).toBe(true);
    expect(bStages.some((s) => s.key === "in_review")).toBe(false);
    expect(await scopeB.getStage(stageIds.in_preparation)).toBeNull();
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
