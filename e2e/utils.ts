import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import { generate as generateTotp } from "otplib";
import { Client } from "pg";

export const SEED_PASSWORD = "demo-password-123";

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

/** Sign in; if the account has no TOTP yet, enroll it. Ends on /app. */
export async function loginEnrollingMfa(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(app|setup-mfa|verify-mfa)/);

  if (page.url().includes("verify-mfa")) {
    throw new Error(`${email} already has TOTP enrolled — reseed (pnpm db:seed) before e2e`);
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
