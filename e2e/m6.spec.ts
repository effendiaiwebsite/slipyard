import { expect, test } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M6 acceptance: a T183-like PDF goes draft → sent → signed, and the executed
 * PDF is immutable (a NEW object in the signed/ prefix — the source is never
 * touched). The exact CRA timestamp format is asserted in tests/esign.test.ts
 * (unit); here we prove the end-to-end flow through the real UI + S3.
 *
 * Seed facts leaned on: Ruth Okafor (ccccccc1…005) has a REAL one-page
 * engagement-letter PDF in the vault (d0c…00e1) and a seeded "sent" signature
 * request (e519a7e0…0001) with a signature + date field placed.
 */
test.describe.configure({ mode: "serial" });

const RUTH_ID = "ccccccc1-0000-4000-8000-000000000005";
const SEEDED_REQUEST = "e519a7e0-0000-4000-8000-000000000001";
const SOURCE_DOC = "d0c00001-0000-4000-8000-0000000000e1";

test("staff creates a request from a PDF, places a field, and sends it (draft → sent)", async ({
  page,
}) => {
  // First-touch of the e-sign routes compiles pdf-lib in the dev server.
  test.setTimeout(120_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto(`/app/clients/${RUTH_ID}`);

  // The engagement-letter PDF offers "Request signature".
  const docRow = page.locator("li", { hasText: "Engagement letter - Ruth Okafor 2025.pdf" });
  await docRow.getByRole("button", { name: "Request signature" }).click();

  // Lands on the draft editor.
  await page.waitForURL(/\/app\/esign\/[0-9a-f-]{36}$/, { timeout: 90_000 });

  // Place a signature field by clicking the page box.
  await page.getByTestId("esign-page-box").first().click({ position: { x: 120, y: 240 } });
  await expect(page.getByText("Signature", { exact: true }).first()).toBeVisible();

  // Send it (Ruth's email is prefilled as the signer contact).
  await page.getByRole("button", { name: "Send for signature" }).click();

  // Back on the request page, it now reads "Out for signature".
  await expect(page.getByText("Out for signature").first()).toBeVisible({ timeout: 20_000 });

  // And it appears on the e-sign dashboard's open list.
  await page.goto("/app/esign");
  await expect(
    page.getByRole("cell", { name: "Engagement letter - Ruth Okafor 2025" }).first()
  ).toBeVisible();
});

test("ACCEPTANCE: in-person signing stamps an immutable executed PDF", async ({ page }) => {
  test.setTimeout(90_000);
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");

  // Snapshot the source document before signing (immutability probe).
  const sourceBefore = (
    await adminQuery<{ s3_key: string; status: string }>(
      `select s3_key, status from document where id = $1`,
      [SOURCE_DOC]
    )
  )[0];
  expect(sourceBefore.status).toBe("clean");

  // Open the seeded "sent" request and sign it in person.
  await page.goto(`/app/esign/${SEEDED_REQUEST}`);
  await page.getByRole("button", { name: "Sign in person" }).click();
  await page.waitForURL(/\/app\/esign\/[0-9a-f-]{36}\/sign$/);

  // Type the signature (deterministic in e2e — no canvas drawing).
  await page.getByRole("tab", { name: "Type your name" }).click();
  await page.getByLabel("Type your full name to sign").fill("Ruth Okafor");
  await page.getByRole("button", { name: "Apply signature" }).click();

  // Back on the request: signed, with a downloadable executed PDF + audit.
  await page.waitForURL(new RegExp(`/app/esign/${SEEDED_REQUEST}$`));
  await expect(page.getByText("Signed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Download signed PDF" })).toBeVisible();
  await expect(page.getByText("In person")).toBeVisible();

  // The request row records the signature facts.
  const req = (
    await adminQuery<{
      status: string;
      signed_via: string;
      signature_method: string;
      signed_hash: string | null;
      signed_document_id: string | null;
    }>(
      `select status, signed_via, signature_method, signed_hash, signed_document_id
       from signature_request where id = $1`,
      [SEEDED_REQUEST]
    )
  )[0];
  expect(req.status).toBe("signed");
  expect(req.signed_via).toBe("in_person");
  expect(req.signature_method).toBe("typed");
  expect(req.signed_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(req.signed_document_id).toBeTruthy();

  // Immutability: the SOURCE document is byte-for-byte where it was.
  const sourceAfter = (
    await adminQuery<{ s3_key: string; status: string }>(
      `select s3_key, status from document where id = $1`,
      [SOURCE_DOC]
    )
  )[0];
  expect(sourceAfter.s3_key).toBe(sourceBefore.s3_key);
  expect(sourceAfter.status).toBe("clean");

  // The executed PDF is a NEW, distinct object in the signed/ prefix.
  const signed = (
    await adminQuery<{ id: string; source: string; s3_key: string }>(
      `select id, source, s3_key from document where id = $1`,
      [req.signed_document_id]
    )
  )[0];
  expect(signed.source).toBe("esign_executed");
  expect(signed.id).not.toBe(SOURCE_DOC);
  expect(signed.s3_key).toContain("/signed/");

  // The signed copy shows on Ruth's Documents card with a "Signed" badge,
  // alongside the untouched original.
  await page.goto(`/app/clients/${RUTH_ID}`);
  await expect(
    page
      .locator("li", { hasText: "Engagement letter - Ruth Okafor 2025 - signed.pdf" })
      .getByText("Signed", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("li", { hasText: "Engagement letter - Ruth Okafor 2025.pdf" }).first()
  ).toBeVisible();
});
