import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M4 acceptance: staff issue a magic link → client passes the SMS OTP
 * (outbox in dev) → three-card home → checklist → upload through the REAL
 * quarantine/scan pipeline (source=portal_upload) → revocation kills the
 * session. Axe runs on every portal screen — the portal must hold AAA
 * (color-contrast-enhanced included).
 *
 * The magic link and the 6-digit code are read from the outbox table —
 * exactly the SMS a real client would receive (real-phone flow via tunnel
 * stays a manual step; see TESTING.md).
 */
test.describe.configure({ mode: "serial" });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag2aaa", "best-practice"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)
  ).toEqual([]);
}

/** Latest portal magic link texted for a client, straight from the outbox. */
async function latestPortalLink(clientId: string): Promise<string> {
  const rows = await adminQuery<{ body: string }>(
    `select body from outbox
     where channel = 'sms' and meta->>'kind' = 'portal_link' and meta->>'clientId' = $1
     order by created_at desc limit 1`,
    [clientId]
  );
  const url = rows[0]?.body.match(/https?:\/\/[^\s]+\/portal\/[A-Za-z0-9._-]+/)?.[0];
  expect(url, "portal link SMS should be in the outbox").toBeTruthy();
  return url!;
}

/** Latest 6-digit OTP texted for a portal token. */
async function latestOtp(): Promise<string> {
  const rows = await adminQuery<{ body: string }>(
    `select body from outbox
     where channel = 'sms' and meta->>'kind' = 'portal_otp'
     order by created_at desc limit 1`
  );
  const code = rows[0]?.body.match(/\b(\d{6})\b/)?.[1];
  expect(code, "OTP SMS should be in the outbox").toBeTruthy();
  return code!;
}

const RUTH_ID = "ccccccc1-0000-4000-8000-000000000005";

test("clerk issues a portal link; client passes OTP and lands on the three-card home", async ({
  page,
  browser,
}) => {
  // Priya (clerk, front desk) sends Ruth her link — clerks are allowed to.
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto(`/app/clients/${RUTH_ID}`);
  await expect(page.getByText("Portal access")).toBeVisible();
  await page.getByRole("button", { name: "Send portal link" }).click();
  await page.getByPlaceholder(/Mobile number/).fill("+14165550105");
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(page.getByText("Sent — not opened")).toBeVisible({ timeout: 15_000 });

  // Ruth opens the link in her own browser.
  const url = await latestPortalLink(RUTH_ID);
  const client = await browser.newContext();
  const portal = await client.newPage();
  await portal.goto(url);

  // Welcome screen — the GET must NOT have sent a code yet (prefetch safety).
  await expect(portal.getByRole("heading", { name: "Hello Ruth Okafor" })).toBeVisible();
  const otpCountBefore = await adminQuery<{ n: string }>(
    `select count(*) as n from outbox where meta->>'kind' = 'portal_otp'`
  );
  await expectNoAxeViolations(portal);

  await portal.getByRole("button", { name: /Continue — text me the code/ }).click();
  await expect(portal.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  const otpCountAfter = await adminQuery<{ n: string }>(
    `select count(*) as n from outbox where meta->>'kind' = 'portal_otp'`
  );
  expect(Number(otpCountAfter[0].n)).toBe(Number(otpCountBefore[0].n) + 1);
  await expectNoAxeViolations(portal);

  // A wrong code is refused with a friendly message (attempt counted).
  await portal.getByLabel("Your 6-digit code").fill("000001");
  await portal.getByRole("button", { name: "Open my portal" }).click();
  await expect(portal.getByText(/That code isn't right/)).toBeVisible();

  // The real code from the outbox works.
  await portal.getByLabel("Your 6-digit code").fill(await latestOtp());
  await portal.getByRole("button", { name: "Open my portal" }).click();
  await portal.waitForURL(/\/portal\/home/);
  await expect(portal.getByRole("heading", { name: "Hello Ruth Okafor" })).toBeVisible();
  await expect(portal.getByText("Send us a document")).toBeVisible();
  await expect(portal.getByText("What we still need")).toBeVisible();
  await expect(portal.getByText("Sign a form")).toBeVisible();
  // Ruth's seed: NOA + daycare receipts missing.
  await expect(portal.getByText("2 documents are still needed.")).toBeVisible();
  await expectNoAxeViolations(portal);

  await client.close();
});

test("checklist view + upload lands in the vault as portal_upload and checks the item off", async ({
  page,
  browser,
}) => {
  // Fresh link for Ruth (the previous test's session cookie died with its context).
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto(`/app/clients/${RUTH_ID}`);
  await page.getByRole("button", { name: "Send portal link" }).click();
  await page.getByPlaceholder(/Mobile number/).fill("+14165550105");
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(page.getByText("Sent — not opened")).toBeVisible({ timeout: 15_000 });

  const client = await browser.newContext();
  const portal = await client.newPage();
  await portal.goto(await latestPortalLink(RUTH_ID));
  await portal.getByRole("button", { name: /Continue — text me the code/ }).click();
  // Wait for the code screen BEFORE reading the outbox — the fresh OTP row
  // is only committed once the Continue action finishes.
  await expect(portal.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await portal.getByLabel("Your 6-digit code").fill(await latestOtp());
  await portal.getByRole("button", { name: "Open my portal" }).click();
  await portal.waitForURL(/\/portal\/home/);

  // Checklist speaks plain language and knows what's missing vs in.
  await portal.getByRole("link", { name: /What we still need/ }).click();
  await portal.waitForURL(/\/portal\/checklist/);
  await expect(
    portal.getByRole("heading", { name: /2025 personal tax return/ })
  ).toBeVisible();
  const noaRow = portal.locator("li", { hasText: "Prior-year Notice of Assessment" });
  await expect(noaRow.getByText("Still needed")).toBeVisible();
  await expect(
    portal.locator("li", { hasText: "T4 / employment income slips" }).getByText("We have it")
  ).toBeVisible();
  await expectNoAxeViolations(portal);

  // "Send it" preselects the item; choose-a-file path; REAL scan pipeline.
  await noaRow.getByRole("link", { name: "Send it" }).click();
  await portal.waitForURL(/\/portal\/upload\?item=/);
  await expect(portal.getByText(/Sending:/)).toBeVisible();
  await expectNoAxeViolations(portal);

  await expect(async () => {
    await portal.locator('input[type="file"]').setInputFiles({
      name: "noa-ruth.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e fixture: fictional prior-year NOA for Ruth Okafor"),
    });
    await portal.getByRole("button", { name: "Send it now" }).click();
    await expect(portal.getByText("We got it — thank you!")).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await expectNoAxeViolations(portal);

  // The item is checked off once the background scan (M5, ADR-0021)
  // promotes the file — reload until the job lands.
  await expect(async () => {
    await portal.goto("/portal/checklist");
    await expect(
      portal.locator("li", { hasText: "Prior-year Notice of Assessment" }).getByText("We have it")
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await client.close();

  // ...and staff see a vaulted portal upload on Ruth's page. (The checklist
  // row also mentions the filename — filter to the Documents-card row.)
  await expect(async () => {
    await page.goto(`/app/clients/${RUTH_ID}`);
    const docRow = page.locator("li", { hasText: "noa-ruth.pdf" }).filter({ hasText: "In vault" });
    await expect(docRow).toBeVisible({ timeout: 5_000 });
    await expect(docRow.getByText("Portal", { exact: true })).toBeVisible();
  }).toPass({ timeout: 60_000 });
});

test("revoking a link kills the live portal session; org-2 links are invisible", async ({
  page,
  browser,
}) => {
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto(`/app/clients/${RUTH_ID}`);
  await page.getByRole("button", { name: "Send portal link" }).click();
  await page.getByPlaceholder(/Mobile number/).fill("+14165550105");
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(page.getByText("Sent — not opened")).toBeVisible({ timeout: 15_000 });

  const client = await browser.newContext();
  const portal = await client.newPage();
  await portal.goto(await latestPortalLink(RUTH_ID));
  await portal.getByRole("button", { name: /Continue — text me the code/ }).click();
  // Same outbox race as above: the code screen means the OTP is committed.
  await expect(portal.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await portal.getByLabel("Your 6-digit code").fill(await latestOtp());
  await portal.getByRole("button", { name: "Open my portal" }).click();
  await portal.waitForURL(/\/portal\/home/);

  // Joey revokes the in-use link.
  await page.reload();
  const inUseRow = page.locator("li", { hasText: "In use" }).first();
  await inUseRow.getByTitle("Revoke this link").click();
  await expect(page.getByText("Revoked").first()).toBeVisible({ timeout: 15_000 });

  // The client's very next navigation bounces to the landing explainer.
  await portal.goto("/portal/checklist");
  await portal.waitForURL(/\/portal\?reason=session/);
  await expect(portal.getByRole("heading", { name: "Your session has ended" })).toBeVisible();
  await client.close();

  // Tenant isolation: Nina (org 2) sees no Lakeside portal links on her client.
  await loginEnrollingMfa(page, "nina@northerntax.test");
  await page.goto("/app/clients");
  await page.getByRole("cell", { name: /Wendy Moosomin/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByText("Portal access")).toBeVisible();
  // Only Wendy's own seeded link shows — never Lakeside recipients.
  await expect(page.getByText("Wendy Moosomin").nth(1)).toBeVisible();
  await expect(page.getByText("Claire Desjardins")).toHaveCount(0);
  await expect(page.getByText("Ruth Okafor")).toHaveCount(0);
});
