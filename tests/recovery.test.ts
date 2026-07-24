import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/db";
import { resetStaffTwoFactor } from "@/lib/staff-recovery";
import { createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * Post-M10 admin MFA reset (staff-recovery.ts): clearing a user's TOTP
 * enrollment removes the auth_two_factor row, flips the staff_user flag, and
 * revokes every session — and touches nobody else.
 */

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
  // Enroll both fixture users in fake TOTP with a live session each.
  for (const userId of [f.userA, f.userB]) {
    await db.insert(schema.authTwoFactor).values({
      id: crypto.randomUUID(),
      userId,
      secret: "test-secret",
      backupCodes: "test-codes",
      verified: true,
    });
    await db
      .update(schema.staffUser)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.staffUser.id, userId));
    await db.insert(schema.authSession).values({
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }
});

afterAll(async () => {
  await destroyFixture(f); // cascades auth_two_factor/auth_session via user FK
  await pool.end();
});

describe("resetStaffTwoFactor", () => {
  it("clears enrollment, flag, and sessions for the target only", async () => {
    await resetStaffTwoFactor(f.userA);

    const [targetUser] = await db
      .select()
      .from(schema.staffUser)
      .where(eq(schema.staffUser.id, f.userA));
    expect(targetUser.twoFactorEnabled).toBe(false);
    expect(
      await db.select().from(schema.authTwoFactor).where(eq(schema.authTwoFactor.userId, f.userA))
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.authSession).where(eq(schema.authSession.userId, f.userA))
    ).toHaveLength(0);

    // The other user is untouched.
    const [otherUser] = await db
      .select()
      .from(schema.staffUser)
      .where(eq(schema.staffUser.id, f.userB));
    expect(otherUser.twoFactorEnabled).toBe(true);
    expect(
      await db.select().from(schema.authTwoFactor).where(eq(schema.authTwoFactor.userId, f.userB))
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.authSession).where(eq(schema.authSession.userId, f.userB))
    ).toHaveLength(1);
  });
});
