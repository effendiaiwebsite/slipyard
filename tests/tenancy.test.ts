import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope, listMembershipsForUser } from "@/db/scoped";
import { pool } from "@/db";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * THE #1 invariant (§6): org A can never read or write org B's data —
 * through the repository layer, and independently through RLS when someone
 * bypasses the repository with raw SQL as the app role.
 */

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

describe("scoped repository layer", () => {
  it("returns only the scoped org's memberships", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const rows = await scope.listMemberships();
    expect(rows.length).toBe(1);
    expect(rows[0].membership.orgId).toBe(f.orgA);
    expect(rows[0].membership.userId).toBe(f.userA);
  });

  it("cannot see the other org via getOrg", async () => {
    const scopeA = new OrgScope(f.orgA, f.userA);
    const org = await scopeA.getOrg();
    expect(org?.id).toBe(f.orgA);
    // A scope minted for org B by a user with no membership there still only
    // exposes org B — scopes are minted server-side from memberships, but
    // even a wrongly-minted scope never leaks a third org.
    const rows = await scopeA.listAudit();
    for (const r of rows) expect(r.orgId).toBe(f.orgA);
  });

  it("audit writes land in the scoped org only", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    await scope.writeAudit({
      actorType: "staff",
      action: "test.read",
      resourceType: "test",
    });
    const a = await scope.listAudit();
    expect(a.some((r) => r.action === "test.read")).toBe(true);
    const scopeB = new OrgScope(f.orgB, f.userB);
    const b = await scopeB.listAudit();
    expect(b.some((r) => r.action === "test.read")).toBe(false);
  });

  it("pre-org membership lookup sees own rows only", async () => {
    const rows = await listMembershipsForUser(f.userA);
    expect(rows.length).toBe(1);
    expect(rows[0].org.id).toBe(f.orgA);
  });
});

describe("RLS defense-in-depth (raw SQL as app role crm_app)", () => {
  async function asAppRole<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  it("sees nothing without an org context", async () => {
    await asAppRole(async (c) => {
      const r = await c.query(`select * from org_membership where org_id = $1`, [f.orgB]);
      expect(r.rowCount).toBe(0);
      const o = await c.query(`select * from org where id = $1`, [f.orgB]);
      expect(o.rowCount).toBe(0);
    });
  });

  it("scoped to org A, cannot select org B rows even with explicit filters", async () => {
    await asAppRole(async (c) => {
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgA]);
      const cross = await c.query(`select * from org_membership where org_id = $1`, [f.orgB]);
      expect(cross.rowCount).toBe(0);
      const own = await c.query(`select * from org_membership where org_id = $1`, [f.orgA]);
      expect(own.rowCount).toBe(1);
    });
  });

  it("scoped to org A, cannot INSERT into org B (WITH CHECK)", async () => {
    await asAppRole(async (c) => {
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgA]);
      await expect(
        c.query(
          `insert into audit_log (org_id, actor_type, action, resource_type)
           values ($1, 'staff', 'evil.write', 'test')`,
          [f.orgB]
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("cannot UPDATE or DELETE audit_log at all (append-only)", async () => {
    await asAppRole(async (c) => {
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgA]);
      await expect(c.query(`update audit_log set action = 'tampered'`)).rejects.toThrow(
        /permission denied/i
      );
      await expect(c.query(`delete from audit_log`)).rejects.toThrow(/permission denied/i);
    });
  });
});
