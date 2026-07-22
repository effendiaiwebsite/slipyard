import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { generate as generateTotp } from "otplib";
import { Client } from "pg";

export const SEED_PASSWORD = "demo-password-123";

/**
 * TOTP secrets captured at enrollment, persisted so later spec FILES can log
 * the same user back in (each file is a fresh worker process). Cleared by
 * global-setup on every run alongside the reseed.
 */
export const TOTP_SECRETS_FILE = join(__dirname, ".totp-secrets.json");

export function saveTotpSecret(email: string, secret: string) {
  const all = existsSync(TOTP_SECRETS_FILE)
    ? (JSON.parse(readFileSync(TOTP_SECRETS_FILE, "utf8")) as Record<string, string>)
    : {};
  all[email] = secret;
  writeFileSync(TOTP_SECRETS_FILE, JSON.stringify(all));
}

function loadTotpSecret(email: string): string | null {
  if (!existsSync(TOTP_SECRETS_FILE)) return null;
  const all = JSON.parse(readFileSync(TOTP_SECRETS_FILE, "utf8")) as Record<string, string>;
  return all[email] ?? null;
}

/** Admin DB access for test orchestration (reading outbox links, flipping org state). */
export async function adminQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL required for e2e");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(text, params);
    return r.rows as T[];
  } finally {
    await c.end();
  }
}

/**
 * Sign in; enrolls TOTP on first login (persisting the secret), or answers
 * the 2FA challenge with a previously-captured secret. Ends on /app.
 */
export async function loginEnrollingMfa(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(app|setup-mfa|verify-mfa)/);

  if (page.url().includes("verify-mfa")) {
    const secret = loadTotpSecret(email);
    if (!secret) {
      throw new Error(
        `${email} has TOTP enrolled but no captured secret — reseed (pnpm db:seed) before e2e`
      );
    }
    await page.getByLabel("6-digit code").fill(await generateTotp({ secret }));
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.waitForURL(/\/app/);
    return;
  }
  if (!page.url().includes("setup-mfa")) {
    await page.goto("/app");
    if (!page.url().includes("setup-mfa")) return; // already fully in
  }

  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Can't scan? Enter manually").click();
  const uri = await page.locator("code").innerText();
  const secret = new URL(uri).searchParams.get("secret");
  expect(secret).toBeTruthy();
  saveTotpSecret(email, secret!);
  await page.getByLabel("6-digit code from your app").fill(await generateTotp({ secret: secret! }));
  await page.getByRole("button", { name: "Verify and finish" }).click();
  await page.waitForURL(/\/app$/);
}

/** Enroll MFA for a brand-new session currently sitting on /setup-mfa. */
export async function enrollMfa(page: Page, password: string) {
  await page.waitForURL(/\/setup-mfa/);
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Can't scan? Enter manually").click();
  const uri = await page.locator("code").innerText();
  const secret = new URL(uri).searchParams.get("secret");
  expect(secret).toBeTruthy();
  await page.getByLabel("6-digit code from your app").fill(await generateTotp({ secret: secret! }));
  await page.getByRole("button", { name: "Verify and finish" }).click();
  await page.waitForURL(/\/app$/);
}
