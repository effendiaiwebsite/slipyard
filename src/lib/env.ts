import "dotenv/config";
import { z } from "zod";

/**
 * Typed environment. Import `env` from here — never read process.env directly.
 * Fails fast at first import with a list of every missing/invalid variable.
 *
 * Vars that are optional until a later milestone (Stripe, S3, Twilio,
 * Anthropic) are modeled as optional here; the services that need them fail
 * loudly at call time with a pointer to .env.example, and dev fallbacks
 * (outbox, mock AI) kick in where the spec allows.
 */

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalStr = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (see .env.example)"),
  DATABASE_ADMIN_URL: optionalStr,

  // Auth
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .min(32, "FIELD_ENCRYPTION_KEY must be a base64 32-byte key (openssl rand -base64 32)"),
  APP_URL: z.string().url("APP_URL must be a full URL, e.g. http://localhost:3000"),
  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,

  // Stripe (required from M1)
  STRIPE_SECRET_KEY: optionalStr,
  STRIPE_PUBLISHABLE_KEY: optionalStr,
  STRIPE_WEBHOOK_SECRET: optionalStr,
  STRIPE_PRICE_ID: optionalStr,

  // S3 (required from M3)
  AWS_ACCESS_KEY_ID: optionalStr,
  AWS_SECRET_ACCESS_KEY: optionalStr,
  AWS_REGION: z.preprocess(emptyToUndefined, z.string().default("ca-central-1")),
  S3_BUCKET: optionalStr,
  KMS_KEY_ID: optionalStr,

  // ClamAV (required from M3; docker compose up -d clamav)
  CLAMAV_HOST: z.preprocess(emptyToUndefined, z.string().default("127.0.0.1")),
  CLAMAV_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().default(3310)),

  // Twilio (optional; outbox mode without it — set all three to go real)
  TWILIO_ACCOUNT_SID: optionalStr,
  TWILIO_AUTH_TOKEN: optionalStr,
  TWILIO_FROM_NUMBER: optionalStr,

  // Jobs (M5): pg-boss runs inside the Next server (instrumentation.ts).
  // JOBS_ENABLED=false turns the runner off (scripts, one-off tooling).
  JOBS_ENABLED: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("true")),
  // Non-production only: how often the reminder sweep runs (default 5 s in
  // dev/test — the "accelerated clock"; production uses a cron schedule).
  REMINDER_SWEEP_INTERVAL_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(500).optional()
  ),

  // Email
  EMAIL_MODE: z.preprocess(emptyToUndefined, z.enum(["outbox", "ses", "smtp"]).default("outbox")),
  SES_FROM_ADDRESS: optionalStr,
  SMTP_HOST: optionalStr,
  SMTP_PORT: optionalStr,
  SMTP_USER: optionalStr,
  SMTP_PASSWORD: optionalStr,
  SMTP_FROM_ADDRESS: optionalStr,

  // AI (optional until M8; mock mode without it)
  ANTHROPIC_API_KEY: optionalStr,

  // Observability
  SENTRY_DSN: optionalStr,
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(["debug", "info", "warn", "error"]).default("info")),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid environment. Fix the following (see .env.example):\n${lines.join("\n")}`
    );
  }
  const env = parsed.data;

  if (env.EMAIL_MODE === "ses" && !env.SES_FROM_ADDRESS) {
    throw new Error("EMAIL_MODE=ses requires SES_FROM_ADDRESS");
  }
  if (env.EMAIL_MODE === "smtp" && (!env.SMTP_HOST || !env.SMTP_FROM_ADDRESS)) {
    throw new Error("EMAIL_MODE=smtp requires SMTP_HOST and SMTP_FROM_ADDRESS");
  }
  if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together");
  }
  const twilio = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER];
  if (twilio.some(Boolean) && !twilio.every(Boolean)) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER must be set together"
    );
  }
  return env;
}

export const env = loadEnv();

export const features = {
  googleOAuth: !!env.GOOGLE_CLIENT_ID,
  stripe: !!env.STRIPE_SECRET_KEY,
  s3: !!env.S3_BUCKET,
  realSms: !!env.TWILIO_ACCOUNT_SID,
  realAi: !!env.ANTHROPIC_API_KEY,
  jobs: env.JOBS_ENABLED === "true",
} as const;
