import { expect, test, type Page } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M9 acceptance — the generic import wizard end to end:
 *  a messy CSV imports with correct warnings, custom fields are visible, the
 *  SIN is stored encrypted/masked (never plaintext), and "Undo this import"
 *  restores the pre-import state.
 * Plus: the wizard is owner/admin only (clerk denied), and the bulk document
 *  uploader renders its picker + drop zone (the upload pipeline itself is the
 *  same one m3/m4 already exercise, ADR-0035).
 */
test.describe.configure({ mode: "serial" });

// Deterministic, obviously-fake names so we can assert on clean state.
const IMPORT_CSV = [
  "Name,Email,Province,SIN,Loyalty Tier",
  "Zenith Test Import,zenith@example.com,ON,046454286,Gold",
  "Nadir Test Import,not-an-email,ON,123456789,Silver",
  ",ghost@example.com,ON,,Bronze",
].join("\n");

async function countImported(): Promise<number> {
  const [r] = await adminQuery<{ n: number }>(
    `select count(*)::int as n from client where display_name like '%Test Import'`
  );
  return r.n;
}

test("ACCEPTANCE: messy CSV import — warnings, custom fields, masked SIN, rollback restores clean state", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  expect(await countImported()).toBe(0);

  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/settings/import");

  // Step 1 — paste the CSV.
  await page.getByTestId("import-csv").fill(IMPORT_CSV);
  await page.getByTestId("import-continue").click();

  // Step 2 — mapping. "Loyalty Tier" is an unknown header → auto-mapped to a
  // custom field; the seeded template is loadable but we take the suggestion.
  await expect(page.getByTestId("import-mapping")).toBeVisible();
  await expect(page.getByTestId("map-Loyalty Tier")).toHaveValue("custom:Loyalty Tier");
  await page.getByTestId("import-preview").click();

  // Step 3 — review: 2 to import, 1 skipped, warnings surfaced, custom column shown.
  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("2 to import");
  await expect(page.getByTestId("import-summary")).toContainText("1 skipped");
  await expect(review).toContainText("Loyalty Tier"); // custom field visible
  await expect(review).toContainText("Gold");
  await expect(review).toContainText(/SIN is not a valid/i); // warning for 123456789
  await expect(review).toContainText(/doesn't look valid/i); // invalid email warning

  // Commit.
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toBeVisible({ timeout: 20_000 });

  // Two clients created; the valid SIN is stored ENCRYPTED + masked, never plaintext.
  expect(await countImported()).toBe(2);
  const [zen] = await adminQuery<{ id: string; sin_encrypted: string | null; sin_last3: string | null; loyalty: string | null }>(
    `select id, sin_encrypted, sin_last3, custom_fields->>'Loyalty Tier' as loyalty
       from client where display_name = 'Zenith Test Import'`
  );
  expect(zen.loyalty).toBe("Gold");
  expect(zen.sin_last3).toBe("286");
  expect(zen.sin_encrypted).toBeTruthy();
  expect(zen.sin_encrypted).not.toContain("046454286");
  // The invalid-SIN row created a client but with NO sin stored.
  const [nad] = await adminQuery<{ sin_encrypted: string | null }>(
    `select sin_encrypted from client where display_name = 'Nadir Test Import'`
  );
  expect(nad.sin_encrypted).toBeNull();

  // The custom field + masked SIN are visible on the client detail page.
  await verifyDetailInNewTab(context, zen.id);

  // Undo — rollback removes exactly the imported clients (none touched since).
  await page.getByTestId("import-rollback").click();
  await expect(page.getByTestId("import-rollback-result")).toContainText(/removed 2/i, {
    timeout: 20_000,
  });

  // Clean state restored.
  expect(await countImported()).toBe(0);
});

async function verifyDetailInNewTab(
  context: import("@playwright/test").BrowserContext,
  clientId: string
) {
  const tab = await context.newPage();
  try {
    await tab.goto(`/app/clients/${clientId}`);
    await expect(tab.getByText("Loyalty Tier")).toBeVisible();
    await expect(tab.getByText("Gold")).toBeVisible();
    // SIN renders only as the mask.
    await expect(tab.getByText(/\*\*\* \*\*\* 286/)).toBeVisible();
    await expect(tab.getByText("046454286")).toHaveCount(0);
  } finally {
    await tab.close();
  }
}

test("the import wizard is owner/admin only — a clerk is denied", async ({ page }) => {
  test.setTimeout(120_000);
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto("/app/settings/import");
  await expect(page.getByText(/owners and administrators/i)).toBeVisible();
  await expect(page.getByTestId("import-wizard")).toHaveCount(0);
});

test("the bulk document uploader renders a client picker and drop zone", async ({ page }) => {
  test.setTimeout(120_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/documents/bulk");
  await expect(page.getByTestId("bulk-uploader")).toBeVisible();
  await expect(page.getByTestId("bulk-client")).toBeVisible();
  await expect(page.getByText(/Drag files here/i)).toBeVisible();
  // Upload is gated until a client + files are chosen.
  await expect(page.getByTestId("bulk-upload")).toBeDisabled();
});
