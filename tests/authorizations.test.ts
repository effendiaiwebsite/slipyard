import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import {
  effectiveAuthStatus,
  needsAttention,
  summarizeCoverage,
  type AuthorizationRow,
} from "@/lib/authorizations";
import { can, type Actor } from "@/lib/permissions";
import { createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M7 CRA authorizations: effective-status derivation (ADR-0028), the
 * coverage rollup, the uncovered-clients count behind the dashboard card,
 * RLS isolation, and the permission matrix rows.
 */

const TODAY = new Date("2026-07-22T12:00:00Z");

function row(fields: Partial<AuthorizationRow>): AuthorizationRow {
  return {
    id: "a",
    orgId: "o",
    clientId: "c",
    level: "level1",
    status: "active",
    expiryDate: null,
    notes: null,
    createdBy: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...fields,
  };
}

describe("effectiveAuthStatus", () => {
  it("keeps recorded status when there is no expiry", () => {
    expect(effectiveAuthStatus(row({ status: "active" }), TODAY)).toBe("active");
    expect(effectiveAuthStatus(row({ status: "pending" }), TODAY)).toBe("pending");
  });

  it("decays active past its expiry date to expired", () => {
    expect(effectiveAuthStatus(row({ expiryDate: "2026-01-31" }), TODAY)).toBe("expired");
    // Expiry day itself still counts as authorized.
    expect(effectiveAuthStatus(row({ expiryDate: "2026-07-22" }), TODAY)).toBe("active");
    expect(effectiveAuthStatus(row({ expiryDate: "2026-09-15" }), TODAY)).toBe("active");
  });

  it("never resurrects revoked/expired records", () => {
    expect(effectiveAuthStatus(row({ status: "revoked", expiryDate: "2099-01-01" }), TODAY)).toBe(
      "revoked"
    );
  });
});

describe("summarizeCoverage", () => {
  it("returns none for an empty set", () => {
    const cov = summarizeCoverage([], TODAY);
    expect(cov).toEqual({ status: "none", row: null, expiringSoon: false });
    expect(needsAttention(cov)).toBe(true);
  });

  it("best row wins: active beats pending beats expired", () => {
    const rows = [
      row({ id: "expired", expiryDate: "2026-01-31" }),
      row({ id: "pending", status: "pending" }),
      row({ id: "active" }),
    ];
    const cov = summarizeCoverage(rows, TODAY);
    expect(cov.status).toBe("active");
    expect(cov.row?.id).toBe("active");
    expect(needsAttention(cov)).toBe(false);
  });

  it("flags active coverage expiring inside 90 days", () => {
    const cov = summarizeCoverage([row({ expiryDate: "2026-09-15" })], TODAY);
    expect(cov.status).toBe("active");
    expect(cov.expiringSoon).toBe(true);
    expect(needsAttention(cov)).toBe(true);

    const far = summarizeCoverage([row({ expiryDate: "2027-07-22" })], TODAY);
    expect(far.expiringSoon).toBe(false);
  });
});

// ---- DB-backed: CRUD, dashboard count, RLS ----------------------------------

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let coveredClient: string;
let uncoveredClient: string;
let expiredClient: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  coveredClient = (
    await scopeA.createClient({ type: "individual", displayName: "Covered C", createdBy: f.userA })
  ).id;
  uncoveredClient = (
    await scopeA.createClient({ type: "individual", displayName: "Uncovered C", createdBy: f.userA })
  ).id;
  expiredClient = (
    await scopeA.createClient({ type: "individual", displayName: "Expired C", createdBy: f.userA })
  ).id;

  await scopeA.createAuthorization({
    clientId: coveredClient,
    level: "level2",
    status: "active",
    createdBy: f.userA,
  });
  await scopeA.createAuthorization({
    clientId: expiredClient,
    level: "level1",
    status: "active",
    expiryDate: "2020-01-01", // long past — the row says active, reality says no
    createdBy: f.userA,
  });
});

afterAll(async () => {
  await destroyFixture(f);
  const { pool } = await import("@/db");
  await pool.end();
});

describe("OrgScope authorizations", () => {
  it("lists with client context and updates in place", async () => {
    const all = await scopeA.listAuthorizations();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.clientName).sort()).toEqual(["Covered C", "Expired C"]);

    const target = all.find((r) => r.clientName === "Covered C")!;
    const updated = await scopeA.updateAuthorization(target.auth.id, { level: "level3" });
    expect(updated?.level).toBe("level3");
  });

  it("counts clients without a currently-usable authorization", async () => {
    // Uncovered (no rows) + Expired (active row past expiry) = 2.
    expect(await scopeA.countClientsWithoutActiveAuthorization()).toBe(2);
  });

  it("archived clients drop out of the uncovered count", async () => {
    await scopeA.updateClient(uncoveredClient, { status: "archived" });
    expect(await scopeA.countClientsWithoutActiveAuthorization()).toBe(1);
    await scopeA.updateClient(uncoveredClient, { status: "active" });
  });

  it("RLS: org B sees nothing of org A's records", async () => {
    expect(await scopeB.listAuthorizations()).toHaveLength(0);
    const aRecord = (await scopeA.listAuthorizations())[0];
    expect(await scopeB.getAuthorization(aRecord.auth.id)).toBeNull();
    expect(await scopeB.countClientsWithoutActiveAuthorization()).toBe(0);
  });

  it("delete removes the record", async () => {
    const created = await scopeA.createAuthorization({
      clientId: uncoveredClient,
      level: "level1",
      status: "pending",
    });
    await scopeA.deleteAuthorization(created.id);
    expect(await scopeA.getAuthorization(created.id)).toBeNull();
  });
});

describe("permission matrix — authorizations", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: "u1", orgId: "o1", role });
  const res = (assignedTo: string | null) => ({
    orgId: "o1",
    type: "cra_authorization",
    assignedTo,
  });

  it("accountant manages only assigned; clerk views but never manages", () => {
    expect(can(actor("owner"), "authorizations.manage", res(null))).toBe(true);
    expect(can(actor("admin"), "authorizations.manage", res(null))).toBe(true);
    expect(can(actor("accountant"), "authorizations.manage", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "authorizations.manage", res("u2"))).toBe(false);
    expect(can(actor("clerk"), "authorizations.manage", res("u1"))).toBe(false);
    expect(can(actor("clerk"), "authorizations.view")).toBe(true);
  });
});
