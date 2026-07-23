import { expect, test, type Page } from "@playwright/test";
import { adminQuery, loginEnrollingMfa } from "./utils";

/**
 * M8 acceptance (mock AI engine — no ANTHROPIC_API_KEY in e2e, which per
 * ADR-0031 runs the SAME permission-scoped tool layer as the real model):
 *  (1) assistant answers respect role scoping — the clerk (all-clients view)
 *      and the assigned-only accountant get DIFFERENT numbers from the same
 *      question, each matching their own visibility;
 *  (2) drafting an email creates NO message and NO outbox row — only the
 *      explicit "Send via Messaging" click sends, through the M5 layer.
 *
 * Seed facts: Lakeside has 9 active clients; sam@ (accountant,
 * assigned_only) holds 4 (Marc, Hélène, Ruth, Pines & Birch). Ruth's 2025 T1
 * sits in awaiting_docs with "Prior-year Notice of Assessment" + "Daycare
 * receipts" required-missing, and she has an email address on file.
 */
test.describe.configure({ mode: "serial" });

const RUTH = "Ruth Okafor";

async function askAssistant(page: Page, question: string): Promise<string> {
  await page.goto("/app/ai/assistant");
  await page.getByLabel("Question for the assistant").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.getByTestId("chat-assistant").last();
  await expect(answer).toBeVisible({ timeout: 20_000 });
  return (await answer.innerText()).trim();
}

function activeClientCount(answer: string): number {
  const m = answer.match(/Active clients in your view: (\d+)/);
  expect(m, `assistant answer should carry the scoped client count:\n${answer}`).toBeTruthy();
  return Number(m![1]);
}

test("ACCEPTANCE: assistant answers respect role scoping (clerk vs assigned-only accountant)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Clerk: sees the whole client book (ADR-0023).
  await loginEnrollingMfa(page, "priya@lakesidecpa.test");
  const clerkAnswer = await askAssistant(page, "How does the pipeline look?");
  const clerkCount = activeClientCount(clerkAnswer);

  // Accountant in the default assigned_only mode: sees only their own book.
  await page.context().clearCookies();
  await loginEnrollingMfa(page, "sam@lakesidecpa.test");
  const samAnswer = await askAssistant(page, "How does the pipeline look?");
  const samCount = activeClientCount(samAnswer);

  expect(samCount).toBeLessThan(clerkCount);
  expect(samCount).toBeGreaterThan(0);

  // The runs were logged (accountability surface, ADR-0031).
  const logged = await adminQuery<{ n: number }>(
    `select count(*)::int as n from ai_interaction where feature = 'assistant'`
  );
  expect(logged[0].n).toBeGreaterThanOrEqual(2);
});

test("ACCEPTANCE: email drafts never auto-send — only the explicit send does", async ({ page }) => {
  test.setTimeout(180_000);

  const counts = async () => {
    const [r] = await adminQuery<{ messages: number; outbox: number }>(
      `select
         (select count(*)::int from message) as messages,
         (select count(*)::int from outbox) as outbox`
    );
    return r;
  };
  const before = await counts();

  await loginEnrollingMfa(page, "joey@lakesidecpa.test");
  await page.goto("/app/ai/emails");
  await page.getByLabel("Client").selectOption({ label: RUTH });
  await page
    .getByLabel("Draft instructions")
    .fill("Gently remind them about the documents we still need.");
  await page.getByRole("button", { name: "Draft email" }).click();

  // The draft appears, grounded in Ruth's real missing checklist items.
  // (Assert on "Daycare receipts" — the one item no earlier spec satisfies;
  // m4's portal upload legitimately clears her NOA item in full-suite runs.)
  const draft = page.getByTestId("email-draft");
  await expect(draft).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Subject")).toHaveValue(/2025 T1/);
  await expect(page.getByLabel("Email body")).toHaveValue(/Hello Ruth/);
  await expect(page.getByLabel("Email body")).toHaveValue(/Daycare receipts/);

  // …but NOTHING was sent or even queued by drafting.
  const afterDraft = await counts();
  expect(afterDraft).toEqual(before);

  // The human edits, then explicitly sends — that goes through M5 messaging.
  await page.getByLabel("Subject").fill("Two documents left for your 2025 T1 return");
  await page.getByTestId("send-draft").click();
  await expect(page.getByTestId("send-result")).toBeVisible({ timeout: 20_000 });

  const afterSend = await counts();
  expect(afterSend.messages).toBe(before.messages + 1);
  expect(afterSend.outbox).toBe(before.outbox + 1);

  // The send log shows a manual email with the edited subject.
  const [sent] = await adminQuery<{ subject: string; kind: string; status: string }>(
    `select subject, kind, status from message order by created_at desc limit 1`
  );
  expect(sent.subject).toBe("Two documents left for your 2025 T1 return");
  expect(sent.kind).toBe("manual");
  expect(["sent", "queued"]).toContain(sent.status);
});
