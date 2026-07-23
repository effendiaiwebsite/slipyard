import { expect, test } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M10 polish acceptance:
 *  (1) the clerk lands on the FRONT-DESK dashboard (intake queue, firm-wide
 *      documents outstanding, portal uploads) instead of the personal
 *      variant that read as zeros (ADR-0036);
 *  (2) the "Documents outstanding" card shows the REAL missing-required
 *      count (the "Arrives in M3" placeholder is gone);
 *  (3) the e-sign draft editor paints the real PDF page behind the
 *      placement boxes via pdf.js (ADR-0037) — proven by pixels on the
 *      box's canvas;
 *  (4) the AI usage viewer lists runs for owner/admin and denies clerks;
 *  (5) 404s and the marketing/pricing page render their M10 states.
 *
 * NOTE this file sorts between m1 and m2 — everything here relies on the
 * fresh seed only, and its only writes are additive (one mock assistant
 * run) or self-cleaning (a draft signature request that is canceled).
 */
test.describe.configure({ mode: "serial" });

const ORG1 = "11111111-1111-4111-8111-111111111111";
const RUTH_ID = "ccccccc1-0000-4000-8000-000000000005";

async function missingRequired() {
  const [r] = await adminQuery<{ items: number; engagements: number }>(
    `select count(*)::int as items, count(distinct engagement_id)::int as engagements
     from checklist_item where org_id = $1 and required and status = 'missing'`,
    [ORG1]
  );
  return r;
}

test("front desk: the clerk dashboard shows intake + firm-wide document state", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const [{ n: intakeCount }] = await adminQuery<{ n: number }>(
    `select count(*)::int as n from document where org_id = $1 and engagement_id is null`,
    [ORG1]
  );
  const missing = await missingRequired();

  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto("/app");

  // The front-desk variant, not the personal one.
  await expect(page.getByText("front desk", { exact: false })).toBeVisible();
  await expect(page.getByText("Your personal dashboard")).toHaveCount(0);

  // Intake stat matches the DB (seed: 3 unfiled documents).
  const intakeCard = page.locator("a", { hasText: "Documents in intake" });
  await expect(intakeCard).toContainText(String(intakeCount));
  expect(intakeCount).toBeGreaterThan(0);

  // Documents outstanding is wired firm-wide, no placeholder.
  await expect(page.getByText("Arrives in")).toHaveCount(0);
  const outstanding = page.locator("a", { hasText: "Documents outstanding" });
  await expect(outstanding).toContainText(String(missing.items));

  // Intake queue + portal upload cards and quick actions render.
  await expect(page.getByText("Intake queue", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent portal uploads")).toBeVisible();
  await expect(page.getByText("No portal uploads yet", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send reminders" })).toBeVisible();
});

test("owner dashboard: Documents outstanding card is wired to the real count", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const missing = await missingRequired();

  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app");

  await expect(page.getByText("Arrives in")).toHaveCount(0);
  const card = page.locator("a", { hasText: "Documents outstanding" });
  await expect(card).toContainText(String(missing.items));
  await expect(card).toContainText(
    missing.engagements === 1 ? "across 1 return" : `across ${missing.engagements} returns`
  );
  // The card links into the Returns page.
  await card.click();
  await page.waitForURL(/\/app\/tax$/);
});

test("e-sign editor paints the real page behind the placement boxes (pdf.js)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto(`/app/clients/${RUTH_ID}`);

  // Create a fresh draft from the seeded REAL engagement-letter PDF.
  const docRow = page.locator("li", { hasText: "Engagement letter - Ruth Okafor 2025.pdf" });
  await docRow.getByRole("button", { name: "Request signature" }).click();
  await page.waitForURL(/\/app\/esign\/[0-9a-f-]{36}$/, { timeout: 90_000 });

  // pdf.js loads, fetches /api/esign/[id]/source, and paints the canvas.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            '[data-testid="esign-page-box"] canvas'
          );
          if (!canvas || canvas.width === 0) return "unpainted";
          const ctx = canvas.getContext("2d");
          if (!ctx) return "no-context";
          const d = ctx.getImageData(0, 0, 80, 80).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return "painted";
          return "blank";
        }),
      { timeout: 60_000 }
    )
    .toBe("painted");

  // Placement still works exactly as in M6 on top of the render.
  await page.getByTestId("esign-page-box").first().click({ position: { x: 120, y: 240 } });
  await expect(page.getByText("Signature", { exact: true }).first()).toBeVisible();

  // Clean up: cancel the draft so the M6 spec meets the same seed state.
  await page.getByRole("button", { name: "Cancel request" }).click();
  await page.waitForURL(/\/app\/esign$/);
});

test("AI usage viewer: owner sees logged runs; clerks are denied", async ({ page }) => {
  test.setTimeout(180_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  // Generate one run through the real (mock-engine) assistant page.
  await page.goto("/app/ai/assistant");
  await page.getByLabel("Question for the assistant").fill("What needs attention this week?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("chat-assistant").last()).toBeVisible({ timeout: 20_000 });

  await page.goto("/app/settings/ai-usage");
  await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
  await expect(page.getByText("Assistant", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("What needs attention this week?").first()).toBeVisible();

  // Clerks (no audit.view) get the friendly denial, not the log.
  await page.context().clearCookies();
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto("/app/settings/ai-usage");
  await expect(page.getByText("You don't have access to this section.")).toBeVisible();
});

test("M10 shell polish: staff 404 and the marketing/pricing page", async ({ page }) => {
  test.setTimeout(120_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  // A nonexistent client id renders the styled staff 404 (same page an
  // out-of-scope accountant sees — no existence leak).
  await page.goto("/app/clients/00000000-0000-4000-8000-00000000dead");
  await expect(page.getByText("Not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the dashboard" })).toBeVisible();

  // Marketing page carries the real pricing.
  await page.goto("/");
  await expect(page.getByText("$300")).toBeVisible();
  await expect(page.getByText("/ month per firm")).toBeVisible();
  await expect(page.getByText("Simple pricing")).toBeVisible();
});
