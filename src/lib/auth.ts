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
  appName: "Accountant CRM",
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
    max: 30,
  },
  plugins: [
    twoFactor({
      issuer: "Accountant CRM",
      skipVerificationOnEnable: false,
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
