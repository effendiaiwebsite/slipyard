import { expect, test } from "@playwright/test";
import { loginEnrollingMfa } from "./utils";

/**
 * M7 acceptance: (1) the CRA authorization coverage dashboard is correct vs
 * the seed, (2) AFR compare works from a pasted CSV, (3) an invoice PDF
 * generates. Matching/money edge cases live in tests/afr.test.ts,
 * tests/authorizations.test.ts and tests/timebilling.test.ts.
 *
 * Seed facts leaned on (org 1, 9 active clients): covered = Marc (L2),
 * Hélène (L1, expires 2026-09-15 → "expiring soon"), Pines & Birch (L3);
 * An pending; Blackwood Trust active-but-expired; Linh revoked;
 * Ruth/Sofia/Dmitri no record → 6 without CRA access. One seeded invoice
 * INV-0001 (sent, $932.25).
 */
test.describe.configure({ mode: "serial" });

const SOFIA_ID = "ccccccc1-0000-4000-8000-000000000006";
const RUTH_ID = "ccccccc1-0000-4000-8000-000000000005";

test("ACCEPTANCE: authorization coverage dashboard is correct vs the seed", async ({ page }) => {
  test.setTimeout(120_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  // Dashboard card: 6 active clients lack a usable authorization.
  const card = page.locator('a[href="/app/tax/authorizations"]', {
    hasText: "Authorization coverage",
  });
  await expect(card.getByText("6", { exact: true })).toBeVisible();

  // Coverage page stats match the seed exactly.
  await page.goto("/app/tax/authorizations");
  await expect(page.getByText("3 / 9")).toBeVisible();
  await expect(page.getByText("Expiring soon", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Pending with CRA", { exact: true }).first()).toBeVisible();

  // Per-client verdicts.
  await expect(page.getByTestId("auth-coverage-row")).toHaveCount(9);
  await expect(page.getByText("No authorization")).toHaveCount(3); // Ruth, Sofia, Dmitri
  const row = (name: string) => page.getByTestId("auth-coverage-row").filter({ hasText: name });
  await expect(row("Hélène Desjardins").getByText("Expiring soon")).toBeVisible();
  await expect(row("An Nguyen").getByText("Pending CRA")).toBeVisible();
  await expect(row("Blackwood Family Trust").getByText("Expired", { exact: true })).toBeVisible();
  await expect(row("Linh Nguyen").getByText("Revoked")).toBeVisible();
  await expect(row("Marc Desjardins").getByText("Active", { exact: true })).toBeVisible();

  // Recording a new active authorization moves the needle: Sofia 3/9 → 4/9.
  await page.goto(`/app/clients/${SOFIA_ID}`);
  await page.locator('select[name="level"]').selectOption("level2");
  await page.locator('select[name="status"]').selectOption("active");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("li", { hasText: "Level 2 — view & change" })).toBeVisible();

  await page.goto("/app/tax/authorizations");
  await expect(page.getByText("4 / 9")).toBeVisible();
  await page.goto("/app");
  await expect(card.getByText("5", { exact: true })).toBeVisible();
});

test("ACCEPTANCE: AFR compare works from a pasted CSV and can track a missing slip", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/tax/afr");

  await page.locator('select[name="clientId"]').selectOption({ label: "Ruth Okafor" });
  await page.getByRole("button", { name: "Load sample CSV" }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  // Ruth's T1 checklist tracks T4 (received) — the other four sample slips
  // (T5 ×2, T4A(OAS), RRSP) have nothing covering them.
  const results = page.getByTestId("afr-results");
  await expect(results).toBeVisible();
  await expect(results.getByText("4 mismatches")).toBeVisible();
  await expect(page.getByTestId("afr-slip-on_file")).toHaveCount(1);
  await expect(page.getByTestId("afr-slip-untracked")).toHaveCount(4);
  await expect(
    page.getByTestId("afr-slip-on_file").getByText("T4 / employment income slips")
  ).toBeVisible();

  // One click starts tracking the Scotiabank T5 on the engagement checklist.
  await page
    .getByTestId("afr-slip-untracked")
    .filter({ hasText: "Scotiabank" })
    .getByRole("button", { name: "Track on checklist" })
    .click();
  await expect(page.getByText("Added to checklist")).toBeVisible();

  await page.goto(`/app/clients/${RUTH_ID}`);
  await expect(page.getByText("T5 slip — Scotiabank")).toBeVisible();
});

test("ACCEPTANCE: record time → invoice → the invoice PDF generates", async ({ page }) => {
  test.setTimeout(90_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/billing");

  // The seeded invoice is on the books.
  await expect(page.getByText("INV-0001")).toBeVisible();
  await expect(page.getByText("$932.25")).toBeVisible();

  // Record an hour for Sofia at the default $200/h.
  await page.locator('select[name="clientId"]').selectOption({ label: "Sofia Marinov" });
  await page.getByLabel("Hours").fill("1");
  await page.getByPlaceholder("What did you work on?").fill("Sorted the T4 photo mixup");
  await page.getByRole("button", { name: "Record time", exact: true }).click();

  // She shows in unbilled WIP; invoice her.
  const wipRow = page.getByTestId("wip-row").filter({ hasText: "Sofia Marinov" });
  await expect(wipRow.getByText("$200.00")).toBeVisible();
  await wipRow.getByRole("button", { name: "Create invoice" }).click();

  // Lands on the new invoice: per-org number 2, $200 + 13% HST.
  await page.waitForURL(/\/app\/billing\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByText("INV-0002").first()).toBeVisible();
  await expect(page.getByTestId("invoice-total")).toHaveText("$226.00");

  // The PDF endpoint serves a real PDF through the staff session.
  const url = page.url().replace(/\/app\/billing\/invoices\//, "/api/billing/invoices/") + "/pdf";
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");

  // Status marches forward and the entry reads Invoiced.
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
  await page.goto("/app/billing");
  await expect(
    page.locator("tr", { hasText: "Sorted the T4 photo mixup" }).getByText("Invoiced")
  ).toBeVisible();
});
