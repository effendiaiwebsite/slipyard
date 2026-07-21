import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/db";
import {
  OrgScope,
  acceptInvitation,
  createOrgForUser,
  findInvitationByTokenHash,
  listMembershipsForUser,
} from "@/db/scoped";
import { hashInviteToken, invitationProblem } from "@/lib/invites";
import { adminUrl, appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

describe("invite token hygiene", () => {
  it("hashes deterministically and never equals the raw token", () => {
    const raw = randomBytes(32).toString("base64url");
    expect(hashInviteToken(raw)).toBe(hashInviteToken(raw));
    expect(hashInviteToken(raw)).not.toContain(raw);
  });

  it("invitationProblem covers revoked/accepted/expired/ok", () => {
    const base = {
      revokedAt: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    } as Parameters<typeof invitationProblem>[0];
    expect(invitationProblem(base)).toBeNull();
    expect(invitationProblem({ ...base!, revokedAt: new Date() })).toMatch(/revoked/);
    expect(invitationProblem({ ...base!, acceptedAt: new Date() })).toMatch(/already used/);
    expect(invitationProblem({ ...base!, expiresAt: new Date(Date.now() - 1) })).toMatch(/expired/);
    expect(invitationProblem(null)).toMatch(/isn't valid/);
  });
});

describe("invitation flow against RLS", () => {
  const raw = randomBytes(32).toString("base64url");
  const inviteeEmail = `invitee-${randomUUID().slice(0, 8)}@test.local`;
  let newUserId: string;

  it("creates an invitation via the org scope", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const inv = await scope.createInvitation({
      email: inviteeEmail,
      phone: null,
      name: "Invitee Test",
      role: "clerk",
      tokenHash: hashInviteToken(raw),
      invitedBy: f.userA,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(inv.orgId).toBe(f.orgA);
  });

  it("raw SQL as app role sees no invitations without a context", async () => {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    const r = await c.query(`select * from invitation where org_id = $1`, [f.orgA]);
    await c.end();
    expect(r.rowCount).toBe(0);
  });

  it("token-hash lookup exposes exactly the matching row", async () => {
    const found = await findInvitationByTokenHash(hashInviteToken(raw));
    expect(found?.invitation.email).toBe(inviteeEmail);
    expect(found?.orgName).toBe("Test Org A");
    expect(await findInvitationByTokenHash(hashInviteToken("wrong-token"))).toBeNull();
  });

  it("accepting creates the membership and stamps the invite", async () => {
    newUserId = `test-user-${randomUUID()}`;
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(
      `insert into staff_user (id, name, email) values ($1, 'Invitee Test', $2)`,
      [newUserId, inviteeEmail]
    );
    await admin.end();

    const found = await findInvitationByTokenHash(hashInviteToken(raw));
    const inv = found!.invitation;
    await acceptInvitation(inv.id, inv.orgId, inv.tokenHash, newUserId, inv.role, inv.invitedBy);

    const memberships = await listMembershipsForUser(newUserId);
    expect(memberships.length).toBe(1);
    expect(memberships[0].org.id).toBe(f.orgA);
    expect(memberships[0].membership.role).toBe("clerk");

    const after = await findInvitationByTokenHash(hashInviteToken(raw));
    expect(after?.invitation.acceptedAt).not.toBeNull();
  });

  it("cleanup invitee", async () => {
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`delete from audit_log where actor_user_id = $1`, [newUserId]);
    await admin.query(`delete from staff_user where id = $1`, [newUserId]);
    await admin.end();
  });
});

describe("org creation bootstrap", () => {
  let ownerId: string;
  let orgId: string;

  it("creates org + owner membership under RLS without bypass", async () => {
    ownerId = `test-user-${randomUUID()}`;
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(
      `insert into staff_user (id, name, email) values ($1, 'Founder Test', $1 || '@test.local')`,
      [ownerId]
    );
    await admin.end();

    orgId = await createOrgForUser(ownerId, "Bootstrap Firm", "America/Toronto");
    const memberships = await listMembershipsForUser(ownerId);
    expect(memberships.length).toBe(1);
    expect(memberships[0].membership.role).toBe("owner");
    expect(memberships[0].org.name).toBe("Bootstrap Firm");
    expect(memberships[0].org.trialEndsAt).not.toBeNull();

    // The new org is invisible from another org's scope.
    const audit = await new OrgScope(f.orgB, f.userB).listAudit(50);
    expect(audit.every((a) => a.orgId === f.orgB)).toBe(true);
  });

  it("cleanup bootstrap org", async () => {
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`delete from audit_log where org_id = $1`, [orgId]);
    await admin.query(`delete from org where id = $1`, [orgId]);
    await admin.query(`delete from staff_user where id = $1`, [ownerId]);
    await admin.end();
  });
});
