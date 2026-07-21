import { randomUUID } from "node:crypto";
import { Client } from "pg";

/**
 * Test fixtures are created via the ADMIN connection (bypasses RLS on
 * purpose) and are independent of scripts/seed.ts — tests never assume the
 * seed ran. Everything is tagged with a run-unique prefix and cleaned up.
 */

export function adminUrl(): string {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL / DATABASE_URL required for tests");
  return url;
}

export function appRoleUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for tests");
  return url;
}

export type Fixture = {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
};

export async function createFixture(): Promise<Fixture> {
  const f: Fixture = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    userA: `test-user-${randomUUID()}`,
    userB: `test-user-${randomUUID()}`,
  };
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query(`insert into org (id, name) values ($1, 'Test Org A'), ($2, 'Test Org B')`, [
      f.orgA,
      f.orgB,
    ]);
    await c.query(
      `insert into staff_user (id, name, email) values
       ($1, 'Test User A', $1 || '@test.local'),
       ($2, 'Test User B', $2 || '@test.local')`,
      [f.userA, f.userB]
    );
    await c.query(
      `insert into org_membership (org_id, user_id, role) values
       ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [f.orgA, f.userA, f.orgB, f.userB]
    );
  } finally {
    await c.end();
  }
  return f;
}

export async function destroyFixture(f: Fixture) {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query(`delete from audit_log where org_id in ($1, $2)`, [f.orgA, f.orgB]);
    await c.query(`delete from org where id in ($1, $2)`, [f.orgA, f.orgB]);
    await c.query(`delete from staff_user where id in ($1, $2)`, [f.userA, f.userB]);
  } finally {
    await c.end();
  }
}
