import { expect, test } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M5 acceptance: templates are editable in Settings (with variable
 * validation); a mass send fans out to per-recipient message rows through
 * the job runner, skipping unusable/opted-out channels and landing on the
 * contact timeline; and — the milestone's headline — a SCHEDULED reminder
 * fires under the accelerated clock (dev sweep interval, seconds not
 * minutes) for a return that has genuinely sat in an awaiting-docs stage
 * past the policy threshold, exactly once per cadence window.
 *
 * Seed facts this file leans on: Ruth Okafor's 2025 T1 entered
 * "Awaiting docs" on 2026-06-30 (weeks ago) with required items missing;
 * Hélène Desjardins has no email and texted STOP (sms_opt_out_at set).
 */
test.describe.configure({ mode: "serial" });

const RUTH_ID = "ccccccc1-0000-4000-8000-000000000005";

test("owner edits templates in Settings; unknown variables are rejected", async ({ page }) => {
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/settings/templates");

  // The org's seeded defaults are present. (exact: the reminder-policy
  // template dropdown repeats each name with a channel suffix.)
  await expect(page.getByText("Missing documents reminder (text)", { exact: true })).toBeVisible();
  await expect(page.getByText("Missing documents reminder (email)", { exact: true })).toBeVisible();
  await expect(page.getByText("Tax season kickoff", { exact: true })).toBeVisible();

  // A typo'd placeholder is refused with a pointed message…
  await page.getByRole("button", { name: "New template" }).click();
  await page.getByLabel("Template name").last().fill("Signature ready (text)");
  await page.getByLabel("Channel", { exact: true }).selectOption("sms");
  await page
    .getByLabel("Body")
    .last()
    .fill("Hi {first_name}, your {taxyear} return is ready to sign — {firm_name}");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Unknown variable: {taxyear}")).toBeVisible();

  // …and the corrected version saves. (Form actions reset uncontrolled
  // fields after a submit — refill both.)
  await page.getByLabel("Template name").last().fill("Signature ready (text)");
  await page
    .getByLabel("Body")
    .last()
    .fill("Hi {first_name}, your {tax_year} return is ready to sign — {firm_name}");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.locator("li", { hasText: "Signature ready (text)" }).first()
  ).toBeVisible({ timeout: 15_000 });
});

test("clerk mass-sends a templated email; skips are accounted; timeline updated", async ({
  page,
}) => {
  // Priya (clerk) may send templated messages — front-desk reminders.
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  await page.goto("/app/messaging");

  await page.getByLabel("Template").selectOption({ label: "Tax season kickoff (email)" });
  await page.getByLabel("Select all").check();
  const sendButton = page.getByRole("button", { name: /Send to \d+ clients/ });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // The action reports the split: some clients have no email on file.
  await expect(page.getByText(/Queued \d+ messages · \d+ skipped/)).toBeVisible({
    timeout: 20_000,
  });

  // Delivery runs through the message-send job — poll the log until the
  // batch drains (console adapter in dev flips rows to Sent).
  await expect(async () => {
    await page.goto("/app/messaging");
    const sentRows = page.locator("tr", { hasText: "Mass send" }).filter({ hasText: "Sent" });
    expect(await sentRows.count()).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 60_000 });

  // Skipped rows name the reason (no email on file → "no usable address").
  await expect(
    page
      .locator("tr", { hasText: "Skipped" })
      .filter({ hasText: "no usable address" })
      .first()
  ).toBeVisible();

  // The send landed on the recipient's contact timeline.
  await page.goto(`/app/clients/${RUTH_ID}`);
  await expect(page.getByText('Sent "Tax season kickoff".').first()).toBeVisible({
    timeout: 15_000,
  });
});

test("ACCEPTANCE: a scheduled reminder fires under the accelerated clock, once", async ({
  page,
}) => {
  // Polling windows below outgrow the default 30 s test budget.
  test.setTimeout(150_000);

  // Re-establish the seed premise: when the WHOLE suite runs, m2's board
  // test has dragged Ruth's card to "In preparation" — put the engagement
  // back where the seed had it (awaiting_docs since June 30) so this test
  // proves the elapsed-days policy regardless of spec order.
  await adminQuery(
    `update engagement set
       stage_id = (select id from engagement_stage
                   where org_id = engagement.org_id and key = 'awaiting_docs'),
       status_timestamps = status_timestamps || '{"awaiting_docs":"2026-06-30T14:00:00Z"}'::jsonb,
       updated_at = now()
     where id = $1`,
    ["abcabca1-0000-4000-8000-000000000005"]
  );

  // Baseline: no reminder messages exist for Ruth's engagement yet.
  const countReminders = async () =>
    Number(
      (
        await adminQuery<{ n: string }>(
          `select count(*) as n from message where kind = 'reminder' and client_id = $1`,
          [RUTH_ID]
        )
      )[0].n
    );
  expect(await countReminders()).toBe(0);

  // Joey turns the policy on: nudge after 3 days waiting (Ruth's return has
  // been in "Awaiting docs" since June 30 — well past due), at most every
  // 3 days, on the client's preferred channel (Ruth: email).
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/settings/templates");
  await page.getByRole("checkbox", { name: /Send automatic reminders/ }).check();
  await page.getByLabel(/Nudge after/).fill("3");
  await page.getByLabel(/At most every/).fill("3");
  await page.getByRole("button", { name: "Save reminder policy" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

  // The pg-boss sweep runs every few seconds in dev (REMINDER_SWEEP_INTERVAL_MS,
  // default 5 s) — the accelerated clock. No manual trigger: this is the
  // scheduler firing.
  await expect(async () => {
    expect(await countReminders()).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 45_000, intervals: [2_000] });

  // Exactly once — the cadence guard holds across further sweeps.
  await page.waitForTimeout(12_000);
  expect(await countReminders()).toBe(1);

  // The nudge is visible where staff look: the send log…
  await page.goto("/app/messaging");
  const reminderRow = page
    .locator("tr", { hasText: "Reminder" })
    .filter({ hasText: "Ruth Okafor" });
  await expect(reminderRow.first()).toBeVisible();
  await expect(reminderRow.first().getByText("Sent")).toBeVisible();
  await expect(reminderRow.first().getByText("Automatic")).toBeVisible();

  // …the outbox (the actual email, naming the missing items)…
  const outbox = await adminQuery<{ body: string; subject: string }>(
    `select o.body, o.subject from outbox o
     join message m on m.outbox_id = o.id
     where m.kind = 'reminder' and m.client_id = $1
     order by o.created_at desc limit 1`,
    [RUTH_ID]
  );
  expect(outbox[0].subject).toContain("Documents still needed");
  expect(outbox[0].body).toContain("Daycare receipts");

  // …and Ruth's contact timeline.
  await page.goto(`/app/clients/${RUTH_ID}`);
  await expect(page.getByText(/Automatic reminder sent/).first()).toBeVisible();

  // Leave the org tidy for reruns without a reseed: policy back off.
  await page.goto("/app/settings/templates");
  await page.getByRole("checkbox", { name: /Send automatic reminders/ }).uncheck();
  await page.getByRole("button", { name: "Save reminder policy" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
});

test("STOP consent shows on the client record and blocks the SMS channel", async ({ page }) => {
  // Hélène texted STOP (seed) — staff see it, and a text template treats her
  // as unreachable in the composer.
  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/clients");
  await page.getByPlaceholder(/Search name, tag/).fill("Hélène");
  await page.getByRole("cell", { name: /Hélène Desjardins/ }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByText("No texts (STOP)")).toBeVisible();

  await page.goto("/app/messaging");
  await page
    .getByLabel("Template")
    .selectOption({ label: "Missing documents reminder (text) (text)" });
  const helene = page.locator("label", { hasText: "Hélène Desjardins" });
  await expect(helene.getByText("opted out of texts")).toBeVisible();
});
