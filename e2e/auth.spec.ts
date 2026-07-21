import { expect, test } from "@playwright/test";
import { generate as generateTotp } from "otplib";

/**
 * M0 acceptance: login with mandatory MFA works end-to-end.
 * Requires the deterministic seed (pnpm db:seed). Uses the clerk user so the
 * owner (joey@) stays un-enrolled for manual demos; db:reset restores both.
 */

test("marketing, login, and portal shells render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /practice CRM built for Canadian/i })).toBeVisible();

  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: /link isn't ready yet/i })).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("unauthenticated /app redirects to login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});

test("first login forces TOTP enrollment, then lands on dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("priya@lakesidecpa.test");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Mandatory 2FA: no dashboard until enrolled.
  await page.waitForURL(/\/(app|setup-mfa)/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/setup-mfa/);

  await page.getByLabel("Confirm your password").fill("demo-password-123");
  await page.getByRole("button", { name: "Continue" }).click();

  // Pull the shared secret from the manual-entry fallback and enroll.
  await page.getByText("Can't scan? Enter manually").click();
  const uri = await page.locator("code").innerText();
  const secret = new URL(uri).searchParams.get("secret");
  expect(secret).toBeTruthy();

  await page.getByLabel("6-digit code from your app").fill(await generateTotp({ secret: secret! }));
  await page.getByRole("button", { name: "Verify and finish" }).click();

  await page.waitForURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Welcome back, Priya/i })).toBeVisible();
  // Clerk role ⇒ personal dashboard variant.
  await expect(page.getByText(/Your personal dashboard/i)).toBeVisible();
});
