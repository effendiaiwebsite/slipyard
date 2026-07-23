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
