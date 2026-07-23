import "dotenv/config";
import { Client } from "pg";
import { auth } from "../src/lib/auth";
import { adminUrl, APP_DB_NAME } from "./db-lib";

/**
 * Dev/support recovery for a locked-out staff account: set a known password
 * AND clear the mandatory TOTP enrollment, so the operator can sign in and
 * re-enroll MFA cleanly. Covers the "I signed up, enrolled 2FA, and now I'm
 * locked out with no authenticator / forgot the password" dead-end — there's
 * no self-serve forgot-password or MFA-recovery flow yet (product gap).
 *
 * The password is hashed with better-auth's OWN hasher (auth.$context), so
 * the credential the sign-in endpoint checks against is guaranteed valid.
 * Existing sessions are revoked. Dev only — refuses to run in production.
 *
 *   pnpm reset:login you@firm.test                 # default temp password
 *   pnpm reset:login you@firm.test "my-new-pass10" # choose the password
 */

const DEFAULT_PASSWORD = "changeme-123456";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("reset:login is a dev/support helper — never run it against production.");
  }
  const email = process.argv[2]?.trim().toLowerCase();
  const newPassword = process.argv[3] ?? DEFAULT_PASSWORD;
  if (!email) throw new Error('Usage: pnpm reset:login "<email>" [newPassword]');
  if (newPassword.length < 10) throw new Error("Password must be at least 10 characters.");

  const c = new Client({ connectionString: adminUrl(APP_DB_NAME) });
  await c.connect();
  try {
    const { rows } = await c.query<{ id: string; name: string; two_factor_enabled: boolean }>(
      `select id, name, two_factor_enabled from staff_user where lower(email) = $1`,
      [email]
    );
    if (rows.length === 0) throw new Error(`No staff account with email ${email}.`);
    const user = rows[0];

    // Hash with better-auth's own hasher so /sign-in/email accepts it.
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(newPassword);

    const upd = await c.query(
      `update auth_account set password = $1, updated_at = now()
        where user_id = $2 and provider_id = 'credential'`,
      [hash, user.id]
    );
    if (upd.rowCount === 0) {
      // No credential account (e.g. Google-only) — create one so password login works.
      await c.query(
        `insert into auth_account (id, user_id, provider_id, account_id, password, created_at, updated_at)
         values (gen_random_uuid(), $1, 'credential', $1, $2, now(), now())`,
        [user.id, hash]
      );
      console.log("• created a credential (password) login for this account");
    } else {
      console.log("• password reset");
    }

    // Clear mandatory TOTP so the next login re-enrolls cleanly.
    await c.query(`delete from auth_two_factor where user_id = $1`, [user.id]);
    await c.query(`update staff_user set two_factor_enabled = false where id = $1`, [user.id]);
    console.log("• two-factor cleared (you'll re-enroll on next sign-in)");

    // Revoke existing sessions.
    const sess = await c.query(`delete from auth_session where user_id = $1`, [user.id]);
    console.log(`• ${sess.rowCount ?? 0} existing session(s) revoked`);

    console.log(`\nDone. Sign in as ${email}`);
    console.log(`  password: ${newPassword}`);
    console.log("  → you'll be sent to MFA setup; SAVE the authenticator secret this time.");
    console.log("  → change the password afterward if this was a shared temp value.");
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
