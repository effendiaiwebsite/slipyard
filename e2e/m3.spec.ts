import { expect, test } from "@playwright/test";
import { loginEnrollingMfa } from "./utils";

/**
 * M3 acceptance: upload→scan→assign→auto-advance green against the dev
 * bucket and the local ClamAV container (both REAL here — no mocks).
 * Serial like the rest of the suite; runs after m2.spec (which may have
 * renamed stages and moved seeded engagements — these flows avoid that
 * state or don't depend on it).
 */
test.describe.configure({ mode: "serial" });

const pdfFile = (name: string, text: string) => ({
  name,
  mimeType: "application/pdf" as const,
  buffer: Buffer.from(`%PDF-1.4 e2e fixture: ${text}`),
});

test("upload → scan → checklist → auto-advance, end to end on one client", async ({ page }) => {
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  // Dmitri Volkov is seeded with no engagements — a clean slate.
  await page.goto("/app/clients");
  await page.getByPlaceholder(/Search name, tag/).fill("Dmitri");
  await page.getByRole("cell", { name: /Dmitri Volkov/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // New T1 engagement → checklist instantiates → auto-advance kicks it
  // straight from Not started to Awaiting docs (required items missing).
  await page.getByRole("button", { name: "Add engagement" }).click();
  await expect(page.getByText("Document checklist · 0/7 in")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Change stage").locator("option:checked")).toHaveText(
    "Awaiting docs"
  );

  // Upload a real file against the T4 checklist item — S3 + ClamAV for
  // real. The hidden input's change handler needs hydration; retry until it
  // sticks.
  const t4Row = page.locator("li", { hasText: "T4 / employment income slips" }).first();
  await expect(async () => {
    await t4Row.locator('input[type="file"]').setInputFiles(
      pdfFile("t4-dmitri.pdf", "fictional T4 for Dmitri Volkov")
    );
    await expect(t4Row.getByText("Received")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

  // The uploaded file shows in the Documents card as vaulted.
  await expect(page.getByText("t4-dmitri.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("In vault").first()).toBeVisible();

  // Hand over the other required item at the desk → checklist satisfied →
  // auto-advance to the first in-progress stage.
  const noaRow = page.locator("li", { hasText: "Prior-year Notice of Assessment" }).first();
  await noaRow.getByRole("button", { name: "got it" }).click();
  await expect(page.getByText(/Engagement moved to/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Change stage").locator("option:checked")).toHaveText(
    "In preparation"
  );
});

test("infected documents are flagged, never downloadable, and removable", async ({ page }) => {
  // NOTE deliberately no live EICAR upload here: host antivirus (Norton on
  // this dev machine) intercepts the EICAR payload on localhost HTTP before
  // it reaches the app, resetting the connection — and can temporarily
  // blacklist the upload URL for every later request. Real clamd EICAR
  // detection is proven at the protocol level (INSTREAM) and the verdict
  // routing is covered in tests/documents.test.ts; this test asserts the
  // browser-observable contract using the seeded infected fixture.
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  await page.goto("/app/clients");
  await page.getByPlaceholder(/Search name, tag/).fill("Sofia");
  await page.getByRole("cell", { name: /Sofia Marinov/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const infectedRow = page.locator("li", { hasText: "invoice-attachment.pdf" });
  await expect(infectedRow.getByText("Virus detected")).toBeVisible();
  await expect(infectedRow.getByText("Eicar-Test-Signature")).toBeVisible();
  // Quarantined files must never offer a download.
  await expect(infectedRow.getByRole("button", { name: "Download" })).toHaveCount(0);

  // The scanner-outage fixture is retryable + removable, and the infected
  // one is removable. Remove the infected file (S3 object + row).
  const failedRow = page.locator("li", { hasText: "photo of T4.jpg" });
  await expect(failedRow.getByText("Scan failed")).toBeVisible();
  await expect(failedRow.getByRole("button", { name: "Rescan" })).toBeVisible();

  await expect(async () => {
    await infectedRow.getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("li", { hasText: "invoice-attachment.pdf" })).toHaveCount(0, {
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });
});

test("clerk uploads to intake; can't file; owner files it against a return", async ({ page }) => {
  // Priya (clerk) uploads for Marc.
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto("/app/tax/intake");
  // Controlled inputs + fetch upload — retry the whole gesture until
  // hydration makes it stick (see the EICAR test).
  await expect(async () => {
    await page.getByLabel("Client").selectOption({ label: "Marc Desjardins" });
    await page
      .locator('input[type="file"]')
      .setInputFiles(pdfFile("dropped-off-slips.pdf", "fictional slips folder"));
    await page.getByRole("button", { name: "Upload to intake" }).click();
    await expect(page.getByText(/Received and scanned clean/)).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

  await page.reload();
  const row = page.locator("li", { hasText: "dropped-off-slips.pdf" });
  await expect(row).toBeVisible();
  // Clerks see the queue but have no filing controls.
  await expect(row.getByRole("button", { name: "File it" })).toHaveCount(0);

  // Joey files it against Marc's return, satisfying nothing in particular.
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/tax/intake");
  const ownerRow = page.locator("li", { hasText: "dropped-off-slips.pdf" });
  await expect(ownerRow).toBeVisible();
  await expect(async () => {
    await ownerRow.getByLabel("Engagement").selectOption({ index: 1 });
    await ownerRow.getByRole("button", { name: "File it" }).click();
    await expect(page.locator("li", { hasText: "dropped-off-slips.pdf" })).toHaveCount(0, {
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });
});

test("Returns page: missing-docs dashboard reflects the seed", async ({ page }) => {
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/tax");

  await expect(page.getByRole("heading", { name: "Returns" })).toBeVisible();
  await expect(page.getByText("Returns waiting on documents")).toBeVisible();
  await expect(page.getByText("Required documents still missing")).toBeVisible();

  // Ruth's seeded checklist: T4 received, NOA + daycare receipts missing.
  const ruthRow = page.locator("tr", { hasText: "Ruth Okafor" });
  await expect(ruthRow).toBeVisible();
  await expect(ruthRow.getByText("1/3 required in")).toBeVisible();
  await expect(ruthRow.getByText(/Prior-year Notice of Assessment/)).toBeVisible();

  // Tenant isolation spot-check: org 2's owner sees an empty Returns page.
  await loginEnrollingMfa(page, "nina@northerntax.test");
  await page.goto("/app/tax");
  await expect(page.locator("tr", { hasText: "Ruth Okafor" })).toHaveCount(0);
  await expect(page.locator("tr", { hasText: "Wendy Moosomin" })).toBeVisible();
});
