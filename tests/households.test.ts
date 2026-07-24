import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import { createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * Post-M10 household management: list-with-members, rename, merge (move
 * members + delete source), empty-delete guard, and cross-org isolation.
 */

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

async function makeClient(scope: OrgScope, name: string, householdId?: string) {
  return scope.createClient({
    displayName: name,
    type: "individual",
    preferredChannel: "phone",
    householdId: householdId ?? null,
    createdBy: scope.userId!,
  });
}

describe("household management", () => {
  it("lists households with their members", async () => {
    const h = await scopeA.createHousehold("List household");
    await makeClient(scopeA, "List Member One", h.id);
    await makeClient(scopeA, "List Member Two", h.id);
    const rows = await scopeA.listHouseholdsWithMembers();
    const found = rows.find((r) => r.id === h.id)!;
    expect(found.members.map((m) => m.displayName).sort()).toEqual([
      "List Member One",
      "List Member Two",
    ]);
  });

  it("renames a household", async () => {
    const h = await scopeA.createHousehold("Old Name household");
    const updated = await scopeA.renameHousehold(h.id, "New Name household");
    expect(updated?.name).toBe("New Name household");
  });

  it("merges: members move to the target and the source is deleted", async () => {
    const source = await scopeA.createHousehold("Merge Source");
    const target = await scopeA.createHousehold("Merge Target");
    const a = await makeClient(scopeA, "Merge Member A", source.id);
    await makeClient(scopeA, "Merge Member B", target.id);

    const res = await scopeA.mergeHouseholds(source.id, target.id);
    expect(res).toEqual({ movedCount: 1 });

    const moved = await scopeA.getClient(a.id);
    expect(moved?.householdId).toBe(target.id);
    const rows = await scopeA.listHouseholdsWithMembers();
    expect(rows.find((r) => r.id === source.id)).toBeUndefined();
    expect(rows.find((r) => r.id === target.id)!.members).toHaveLength(2);
  });

  it("refuses to merge a household into itself or into a missing one", async () => {
    const h = await scopeA.createHousehold("Self Merge");
    expect(await scopeA.mergeHouseholds(h.id, h.id)).toBeNull();
    expect(await scopeA.mergeHouseholds(h.id, crypto.randomUUID())).toBeNull();
  });

  it("deletes only empty households", async () => {
    const withMember = await scopeA.createHousehold("Occupied household");
    await makeClient(scopeA, "Occupant", withMember.id);
    expect(await scopeA.deleteEmptyHousehold(withMember.id)).toEqual({
      ok: false,
      reason: "not_empty",
    });

    const empty = await scopeA.createHousehold("Empty household");
    expect(await scopeA.deleteEmptyHousehold(empty.id)).toEqual({ ok: true });
    expect(await scopeA.deleteEmptyHousehold(empty.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("cannot rename, merge into, or delete another org's household", async () => {
    const hA = await scopeA.createHousehold("Org A household");
    const hB = await scopeB.createHousehold("Org B household");

    expect(await scopeB.renameHousehold(hA.id, "hijacked")).toBeNull();
    // Cross-org merge: org B holds only one of the pair → refused.
    expect(await scopeB.mergeHouseholds(hA.id, hB.id)).toBeNull();
    expect(await scopeB.mergeHouseholds(hB.id, hA.id)).toBeNull();
    expect(await scopeB.deleteEmptyHousehold(hA.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // And org A's row is untouched.
    const rows = await scopeA.listHouseholdsWithMembers();
    expect(rows.find((r) => r.id === hA.id)?.name).toBe("Org A household");
  });
});
