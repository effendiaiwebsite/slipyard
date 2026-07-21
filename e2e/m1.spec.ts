import { expect, test } from "@playwright/test";
import { adminQuery, enrollMfa, loginEnrollingMfa } from "./utils";

/**
 * M1 acceptance flows.
 * Serial: the invite flow depends on the owner being enrolled first, and the
 * lapse flow flips org state that the earlier tests assume healthy.
 */
test.describe.configure({ mode: "serial" });

const INVITEE_EMAIL = "taylor@lakesidecpa.test";
const INVITEE_PASSWORD = "brand-new-pass-123";
const ORG1 = "11111111-1111-4111-8111-111111111111";

test("owner invites an employee; invitee joins, enrolls MFA, lands on personal dashboard", async ({
  browser,
}) => {
  // --- Owner side -----------------------------------------------------------
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await loginEnrollingMfa(owner, "joey@lakesidecpa.test");

  await owner.goto("/app/settings/employees");
  await owner.getByLabel("Full name").fill("Taylor New");
  await owner.getByLabel("Email").fill(INVITEE_EMAIL);
  await owner.locator("#inv-role").selectOption("clerk");
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByText("Invitation sent.")).toBeVisible();
  await expect(owner.getByText(INVITEE_EMAIL).first()).toBeVisible();
  await ownerContext.close();

  // --- Grab the invite link from the outbox (dev delivery channel) ----------
  const rows = await adminQuery<{ body: string }>(
    `select body from outbox where org_id = $1 and channel = 'email' order by created_at desc limit 1`,
    [ORG1]
  );
  const link = rows[0]?.body.match(/https?:\/\/\S+\/join\/\S+/)?.[0];
  expect(link).toBeTruthy();

  // --- Invitee side (fresh browser context = fresh person) -------------------
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link!);
  await expect(invitee.getByText(/Join Lakeside CPA/i)).toBeVisible();
  await expect(invitee.getByText(/invited as/i)).toBeVisible();

  await invitee.getByLabel(/Choose a password/i).fill(INVITEE_PASSWORD);
  await invitee.getByRole("button", { name: "Create account and join" }).click();

  // Mandatory MFA before any staff surface.
  await enrollMfa(invitee, INVITEE_PASSWORD);

  // Clerk → personal dashboard variant.
  await expect(invitee.getByRole("heading", { name: /Welcome back, Taylor/i })).toBeVisible();
  await expect(invitee.getByText(/Your personal dashboard/i)).toBeVisible();
  await expect(invitee.getByText("My assigned clients")).toBeVisible();
  await inviteeContext.close();
});

test("subscription lapse flips the org read-only; restore flips it back", async ({ browser }) => {
  await adminQuery(`update org set subscription_status = 'canceled' where id = $1`, [ORG1]);
  try {
    // maria (admin) is still un-enrolled at this point in the serial run, so
    // she can log in fresh here — enrollment itself stays available in
    // read-only mode (auth is not client data).
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await loginEnrollingMfa(p2, "maria@lakesidecpa.test");
    await expect(p2.getByText(/Read-only mode/i)).toBeVisible();

    // Write UI is disabled.
    await p2.goto("/app/settings/employees");
    await expect(p2.getByText(/employee management is paused/i)).toBeVisible();
    await expect(p2.getByRole("button", { name: "Send invitation" })).toBeDisabled();

    // Views still work.
    await p2.goto("/app/settings");
    await expect(p2.getByRole("heading", { name: "Settings" })).toBeVisible();
    await c2.close();
  } finally {
    await adminQuery(`update org set subscription_status = 'trialing' where id = $1`, [ORG1]);
  }
});
