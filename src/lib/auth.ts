import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { db, schema } from "@/db";
import { env, features } from "@/lib/env";

/**
 * Staff authentication (better-auth). Email+password and Google OAuth; TOTP
 * 2FA is MANDATORY — enforced in requireStaff() (src/lib/context.ts), which
 * redirects any session without twoFactorEnabled to /setup-mfa before the
 * staff app renders.
 *
 * Session policy (§6): absolute lifetime 12 h (expiresIn); the 30-min idle
 * timeout is enforced in requireStaff() by comparing session.updatedAt
 * against the clock (updateAge keeps updatedAt ≈ last activity).
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.AUTH_SECRET,
  appName: "SlipYard",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.staffUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
      twoFactor: schema.authTwoFactor,
    },
  }),
  advanced: {
    database: { generateId: () => randomUUID() },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      // Self-serve forgot-password (post-M10 fix). The reset email rides the
      // org outbox like every other send, so in dev the link surfaces via
      // `pnpm outbox`. Imports are lazy on purpose: scripts load this module
      // for the password hasher, and messaging.ts is server-only.
      const subject = "Reset your SlipYard password";
      const body = [
        `Hi ${user.name || "there"},`,
        ``,
        `Someone asked to reset the SlipYard password for this email address.`,
        `If that was you, set a new password here (link expires in 1 hour):`,
        url,
        ``,
        `If you didn't ask, you can ignore this message — your password is unchanged.`,
        `Note: if you use an authenticator app for sign-in, you'll still need it.`,
      ].join("\n");
      const { listMembershipsForUser, OrgScope } = await import("@/db/scoped");
      const memberships = await listMembershipsForUser(user.id);
      if (memberships.length > 0) {
        const { sendEmail } = await import("@/lib/messaging");
        await sendEmail(new OrgScope(memberships[0].org.id, user.id), {
          to: user.email,
          subject,
          body,
          meta: { kind: "password_reset" },
        });
      } else if (env.EMAIL_MODE === "ses") {
        // Pre-org account: no org outbox exists yet — deliver directly.
        const { deliverEmail } = await import("@/lib/message-providers");
        await deliverEmail(user.email, subject, body);
      } else {
        console.log(`\n[outbox:email] to=${user.email} subject="${subject}"\n${body}\n`);
      }
    },
  },
  socialProviders: features.googleOAuth
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : undefined,
  session: {
    expiresIn: 60 * 60 * 12, // absolute 12h
    updateAge: 60 * 5, // refresh updatedAt on activity every 5 min
  },
  rateLimit: {
    enabled: true,
    window: 60,
    // Dev/e2e drive many logins+TOTP enrollments from one IP (localhost);
    // production keeps the tight per-IP budget AND better-auth's stricter
    // built-in per-path rules on sign-in/two-factor endpoints.
    max: env.NODE_ENV === "production" ? 30 : 300,
    customRules:
      env.NODE_ENV === "production"
        ? undefined
        : {
            "/sign-in/email": { window: 10, max: 30 },
            "/two-factor/enable": { window: 10, max: 30 },
            "/two-factor/verify-totp": { window: 10, max: 30 },
          },
  },
  plugins: [
    twoFactor({
      issuer: "SlipYard",
      skipVerificationOnEnable: false,
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
