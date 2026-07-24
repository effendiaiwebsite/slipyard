import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logger } from "@/lib/logger";

/**
 * Admin-driven two-factor reset (post-M10; productizes what
 * scripts/reset-staff-login.ts does for support). Clears the target's TOTP
 * enrollment and revokes every live session, so their next sign-in forces a
 * clean re-enrollment (requireStaff redirects to /setup-mfa).
 *
 * Uses the raw db handle deliberately: auth tables (staff_user,
 * auth_two_factor, auth_session) are global by design — users can belong to
 * multiple orgs — so they sit outside OrgScope/RLS (ARCHITECTURE.md, tenancy
 * note). The CALLER must verify org membership of the target and authorize()
 * BEFORE invoking this; it is not a tenant-data path.
 */
export async function resetStaffTwoFactor(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.authTwoFactor).where(eq(schema.authTwoFactor.userId, userId));
    await tx
      .update(schema.staffUser)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(schema.staffUser.id, userId));
    await tx.delete(schema.authSession).where(eq(schema.authSession.userId, userId));
  });
  logger.info({ targetUserId: userId }, "two-factor reset (admin)");
}
