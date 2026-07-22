import { expect, test } from "@playwright/test";
import { loginEnrollingMfa } from "./utils";

/**
 * M2 acceptance: the firm runs its client list in-app, and the workflow
 * board's drag respects permissions.
 * Serial: sam's transition in the board test builds on state the earlier
 * tests read, and priya's stored TOTP secret comes from auth.spec's run.
 */
test.describe.configure({ mode: "serial" });

const MARC_ENGAGEMENT = "abcabca1-0000-4000-8000-000000000001"; // seed: Marc, noa_received
const RUTH_ENGAGEMENT = "abcabca1-0000-4000-8000-000000000005"; // seed: Ruth, awaiting_docs, sam

test("accountant works a client end-to-end: grid → search → detail → note → contact → stage", async ({
  page,
}) => {
  await loginEnrollingMfa(page, "sam@lakesidecpa.test");

  // Grid shows the seeded book with meta columns.
  await page.goto("/app/clients");
  await expect(page.getByRole("cell", { name: /Marc Desjardins/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Pines & Birch Landscaping/ })).toBeVisible();

  // Search narrows.
  await page.getByPlaceholder(/Search name, tag/).fill("Marc");
  await expect(page.getByRole("cell", { name: /Marc Desjardins/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Pines & Birch/ })).toHaveCount(0);

  // Row click → detail (first dev-compile of the route can be slow).
  await page.getByRole("cell", { name: /Marc Desjardins/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Marc Desjardins" })).toBeVisible();
  await expect(page.getByText("*** *** 286")).toBeVisible();
  expect(await page.content()).not.toContain("046454286");

  // Pinned note from the seed surfaces in the callout (and the notes list).
  await expect(page.getByText(/call his daughter Claire/i).first()).toBeVisible();

  // Household links to the spouse.
  await expect(page.getByRole("link", { name: "Hélène Desjardins" })).toBeVisible();

  // Add a note.
  await page.getByPlaceholder("Add a note…").fill("Brought in a T4A slip today.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Brought in a T4A slip today.")).toBeVisible();

  // Log a contact.
  await page.getByPlaceholder("What happened?").fill("Reminded about RRSP receipt.");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("Reminded about RRSP receipt.")).toBeVisible();

  // Transition Marc's engagement (assigned to sam) back to Filed. The fresh
  // "since <today>" stamp only renders once the server action + revalidation
  // land — waiting on it avoids racing the reload.
  await page.getByLabel("Change stage").selectOption({ label: "Filed" });
  const today = new Date().toLocaleDateString("en-CA");
  await expect(page.getByText(`since ${today}`)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Change stage").locator("option:checked")).toHaveText("Filed");
});

test("workflow board: sam drags his own card; it persists", async ({ page }) => {
  await loginEnrollingMfa(page, "sam@lakesidecpa.test");
  await page.goto("/app/workflow");

  // Ruth (awaiting_docs, assigned to sam) is draggable for sam.
  const card = page.locator(`[data-engagement="${RUTH_ENGAGEMENT}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("draggable", "true");
  // An's engagement is Joey's — sam can view but not move it.
  await expect(page.locator(`[data-engagement="abcabca1-0000-4000-8000-000000000003"]`)).toHaveAttribute(
    "draggable",
    "false"
  );

  // HTML5 DnD: dragstart on the card arms the board, drop lands the column.
  await card.dispatchEvent("dragstart");
  await page.locator('[data-status="in_preparation"]').dispatchEvent("drop");

  await expect(
    page.locator('[data-status="in_preparation"]').locator(`[data-engagement="${RUTH_ENGAGEMENT}"]`)
  ).toBeVisible();
  // The optimistic move is instant; the fresh "since <today>" stamp only
  // renders after the server action + revalidation — wait before reloading.
  const today = new Date().toLocaleDateString("en-CA");
  await expect(card).toContainText(today, { timeout: 15_000 });
  await page.reload();
  await expect(
    page.locator('[data-status="in_preparation"]').locator(`[data-engagement="${RUTH_ENGAGEMENT}"]`)
  ).toBeVisible();
});

test("clerk is read-only: no create/edit affordances, board fully locked", async ({ page }) => {
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");

  await page.goto("/app/clients");
  await expect(page.getByRole("cell", { name: /Marc Desjardins/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);

  await page.getByRole("cell", { name: /Marc Desjardins/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Marc Desjardins" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  await expect(page.getByLabel("Change stage")).toHaveCount(0);

  await page.goto("/app/workflow");
  await expect(page.locator('[data-engagement][draggable="true"]')).toHaveCount(0);
  await expect(page.locator(`[data-engagement="${MARC_ENGAGEMENT}"]`)).toHaveAttribute(
    "draggable",
    "false"
  );
});

test("tenant isolation: the other firm sees none of Lakeside's clients", async ({ page }) => {
  await loginEnrollingMfa(page, "nina@northerntax.test");
  await page.goto("/app/clients");
  await expect(page.getByRole("cell", { name: /Wendy Moosomin/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Marc Desjardins/ })).toHaveCount(0);
  await page.goto("/app/workflow");
  await expect(page.locator(`[data-engagement="${MARC_ENGAGEMENT}"]`)).toHaveCount(0);
});

test("owner customizes workflow stages; the board follows (ADR-0015)", async ({ page }) => {
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/settings/stages");

  // Rename "In review" → "Partner review".
  await page.getByLabel("Rename In review").first().click();
  await page.getByLabel("Rename In review").fill("Partner review");
  await page.getByLabel("Save name").click();
  await expect(page.getByText("Partner review").first()).toBeVisible();

  // Add a brand-new stage.
  await page.getByPlaceholder("New stage name").fill("EFILE queue");
  await page.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByText("EFILE queue").first()).toBeVisible();

  // Board reflects both immediately.
  await page.goto("/app/workflow");
  await expect(page.locator('[data-status="in_review"]').getByText("Partner review")).toBeVisible();
  await expect(page.locator('[data-status="efile-queue"]')).toBeVisible();
  await expect(page.locator('[data-status="in_review"]').getByText("An Nguyen")).toBeVisible();
});
