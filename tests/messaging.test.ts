import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope, findClientsByPhone } from "@/db/scoped";
import { pool } from "@/db";
import { DEFAULT_ENGAGEMENT_STAGES, reminderSettings, defaultReminderSettings } from "@/db/schema";
import { resolveChannel, sendClientMessage } from "@/lib/client-messaging";
import { sweepOrgReminders } from "@/lib/reminders";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  buildTemplateVars,
  findUnknownVariables,
  renderTemplate,
} from "@/lib/templates";
import {
  classifyInboundSms,
  computeTwilioSignature,
  validateTwilioSignature,
} from "@/lib/twilio-webhook";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M5 messaging: template rendering, channel resolution + SMS consent, the
 * message send log (outbox + contact timeline side-effects, console
 * adapter), category-keyed reminder sweep with cadence dedupe, STOP webhook
 * plumbing (signature math + cross-org phone lookup), and RLS on the new
 * tables.
 */

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let systemA: OrgScope;
let stageIds: Record<string, string>;
let templateIdsByName: Record<string, string>;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);
  systemA = new OrgScope(f.orgA, null);

  stageIds = {};
  for (const s of DEFAULT_ENGAGEMENT_STAGES) {
    const row = await scopeA.createStage({ key: s.key, label: s.label, category: s.category });
    stageIds[s.key] = row.id;
  }

  templateIdsByName = {};
  for (const t of DEFAULT_MESSAGE_TEMPLATES) {
    const row = await scopeA.createMessageTemplate(t);
    templateIdsByName[t.name] = row.id;
  }
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

function makeClient(fields: Partial<Parameters<OrgScope["createClient"]>[0]> = {}) {
  return scopeA.createClient({
    displayName: "Messaging Test Client",
    type: "individual",
    preferredChannel: "email",
    email: "client@example.test",
    phone: "+15555550100",
    createdBy: f.userA,
    ...fields,
  });
}

describe("template rendering", () => {
  it("substitutes known variables and reports unresolved ones", () => {
    const vars = buildTemplateVars({
      clientName: "Marc Desjardins",
      firmName: "Lakeside CPA",
      taxYear: 2025,
      missingDocs: ["NOA", "T4"],
      accountantName: "Sam Osei",
    });
    const res = renderTemplate(
      "Hi {first_name} ({client_name}), {firm_name} needs: {missing_docs} for {tax_year}. — {accountant_name} {nonsense}",
      vars
    );
    expect(res.text).toBe(
      "Hi Marc (Marc Desjardins), Lakeside CPA needs: NOA, T4 for 2025. — Sam Osei {nonsense}"
    );
    expect(res.unresolved).toEqual(["nonsense"]);
  });

  it("treats empty values as unresolved (previews can warn)", () => {
    const res = renderTemplate("Missing: {missing_docs}", buildTemplateVars({
      clientName: "X",
      firmName: "Y",
      missingDocs: [],
    }));
    expect(res.unresolved).toEqual(["missing_docs"]);
  });

  it("findUnknownVariables flags typos only", () => {
    expect(findUnknownVariables("Hi {client_name} {clientname}")).toEqual(["clientname"]);
    expect(findUnknownVariables("{missing_docs} {tax_year}")).toEqual([]);
  });
});

describe("channel resolution + consent", () => {
  const base = {
    id: "x",
    displayName: "C",
    email: "c@example.test",
    phone: "+15555550101",
    preferredChannel: "email" as const,
    smsOptOutAt: null as Date | null,
  };

  it("follows the preferred channel and falls back", () => {
    expect(resolveChannel(base, "preferred")).toEqual({ ok: true, channel: "email", to: base.email });
    expect(resolveChannel({ ...base, preferredChannel: "sms" }, "preferred")).toEqual({
      ok: true,
      channel: "sms",
      to: base.phone,
    });
    // phone/mail preferences fall back to email first.
    expect(resolveChannel({ ...base, preferredChannel: "phone" }, "preferred")).toMatchObject({
      channel: "email",
    });
    expect(resolveChannel({ ...base, preferredChannel: "sms", phone: null }, "preferred")).toMatchObject({
      channel: "email",
    });
  });

  it("never texts an opted-out client — even when SMS was requested", () => {
    const optedOut = { ...base, smsOptOutAt: new Date() };
    expect(resolveChannel(optedOut, "sms")).toEqual({ ok: false, skipReason: "sms_opt_out" });
    // preferred: opt-out pushes to email when available…
    expect(resolveChannel({ ...optedOut, preferredChannel: "sms" }, "preferred")).toMatchObject({
      channel: "email",
    });
    // …and reports the opt-out when email isn't.
    expect(resolveChannel({ ...optedOut, preferredChannel: "sms", email: null }, "preferred")).toEqual({
      ok: false,
      skipReason: "sms_opt_out",
    });
  });

  it("reports no_address when nothing is usable", () => {
    expect(resolveChannel({ ...base, email: null }, "email")).toEqual({
      ok: false,
      skipReason: "no_address",
    });
    expect(resolveChannel({ ...base, email: null, phone: null }, "preferred")).toEqual({
      ok: false,
      skipReason: "no_address",
    });
  });
});

describe("sendClientMessage (console adapter)", () => {
  it("writes message + outbox + contact-timeline rows on a delivered send", async () => {
    const client = await makeClient({ displayName: "Send Log Client" });
    const message = await sendClientMessage(scopeA, {
      client,
      kind: "manual",
      requestedChannel: "preferred",
      subject: "Hello",
      body: "Test body",
      contactSummary: 'Sent "Hello".',
    });
    expect(message.status).toBe("sent");
    expect(message.channel).toBe("email");
    expect(message.outboxId).toBeTruthy();
    expect(message.sentAt).toBeTruthy();

    const outbox = await scopeA.listOutbox(10);
    expect(outbox.some((o) => o.id === message.outboxId && o.status === "sent")).toBe(true);

    const detail = await scopeA.getClientDetail(client.id);
    expect(detail?.contacts.some((c) => c.entry.summary === 'Sent "Hello".')).toBe(true);
  });

  it("records a skipped row (no outbox, no contact entry) for an opted-out SMS", async () => {
    const client = await makeClient({
      displayName: "Opted Out Client",
      email: null,
      preferredChannel: "sms",
      smsOptOutAt: new Date(),
    });
    const before = (await scopeA.listOutbox(200)).length;
    const message = await sendClientMessage(scopeA, {
      client,
      kind: "mass",
      requestedChannel: "sms",
      body: "Should not go out",
      contactSummary: "n/a",
    });
    expect(message.status).toBe("skipped");
    expect(message.skipReason).toBe("sms_opt_out");
    expect(message.outboxId).toBeNull();
    expect((await scopeA.listOutbox(200)).length).toBe(before);
    const detail = await scopeA.getClientDetail(client.id);
    expect(detail?.contacts).toHaveLength(0);
  });
});

describe("reminder sweep (category-keyed, ADR-0015)", () => {
  const settings = {
    ...defaultReminderSettings,
    enabled: true,
    awaiting_docs_days: 0, // due immediately — the e2e proves elapsed-days
    cadence_days: 1,
  };

  async function makeAwaitingDocsEngagement(clientId: string) {
    const e = await scopeA.createEngagement({
      clientId,
      type: "t1",
      taxYear: 2025,
      stageId: stageIds.awaiting_docs,
    });
    await scopeA.createChecklistItems(e.id, [
      { title: "Prior-year Notice of Assessment", required: true, position: 0 },
      { title: "Donation receipts", required: false, position: 1 },
    ]);
    return e.id;
  }

  it("nudges exactly the missing REQUIRED items, once per cadence window", async () => {
    const client = await makeClient({ displayName: "Reminder Target" });
    const engagementId = await makeAwaitingDocsEngagement(client.id);

    const sent = await sweepOrgReminders(systemA, "Test Firm A", settings);
    expect(sent).toBe(1);

    const log = await systemA.listRecentMessages(20);
    const reminder = log.find((m) => m.message.engagementId === engagementId);
    expect(reminder).toBeTruthy();
    expect(reminder!.message.kind).toBe("reminder");
    expect(reminder!.message.status).toBe("sent");
    expect(reminder!.message.channel).toBe("email");
    expect(reminder!.message.body).toContain("Prior-year Notice of Assessment");
    expect(reminder!.message.body).not.toContain("Donation receipts");
    expect(reminder!.message.body).toContain("Test Firm A");

    // Cadence: an immediate second sweep must not re-nudge.
    expect(await sweepOrgReminders(systemA, "Test Firm A", settings)).toBe(0);

    // The nudge landed on the contact timeline as a system entry.
    const detail = await scopeA.getClientDetail(client.id);
    expect(detail?.contacts.some((c) => c.entry.summary.startsWith("Automatic reminder"))).toBe(true);

    // Audited as a system action against the engagement.
    const audit = await scopeA.listAudit(50);
    expect(
      audit.some(
        (a) => a.action === "messages.reminder_sent" && a.resourceId === engagementId
      )
    ).toBe(true);
  });

  it("ignores engagements outside awaiting_docs categories and satisfied checklists", async () => {
    const client = await makeClient({ displayName: "Not Due Client" });
    // in_progress category — automation hands-off (ADR-0017 posture).
    const inReview = await scopeA.createEngagement({
      clientId: client.id,
      type: "t1",
      taxYear: 2025,
      stageId: stageIds.in_review,
    });
    await scopeA.createChecklistItems(inReview.id, [
      { title: "Something required", required: true, position: 0 },
    ]);
    // awaiting_docs but only OPTIONAL items missing — nothing to nudge.
    const optionalOnly = await scopeA.createEngagement({
      clientId: client.id,
      type: "t1",
      taxYear: 2025,
      stageId: stageIds.awaiting_docs,
    });
    await scopeA.createChecklistItems(optionalOnly.id, [
      { title: "Optional slip", required: false, position: 0 },
    ]);

    const before = (await systemA.listRecentMessages(100)).length;
    await sweepOrgReminders(systemA, "Test Firm A", settings);
    const after = await systemA.listRecentMessages(100);
    expect(after.filter((m) => m.message.clientId === client.id)).toHaveLength(0);
    expect(after.length).toBe(before);
  });

  it("skips (silently — no row spam) clients with no usable channel", async () => {
    const client = await makeClient({
      displayName: "Unreachable Client",
      email: null,
      phone: "+15555550199",
      preferredChannel: "sms",
      smsOptOutAt: new Date(),
    });
    await makeAwaitingDocsEngagement(client.id);
    await sweepOrgReminders(systemA, "Test Firm A", settings);
    const log = await systemA.listRecentMessages(100);
    expect(log.filter((m) => m.message.clientId === client.id)).toHaveLength(0);
  });

  it("reminderSettings() defaults keep pre-M5 orgs disabled", () => {
    expect(reminderSettings({ ai_enabled: true, accountant_scope_mode: "all_read" })).toMatchObject({
      enabled: false,
      awaiting_docs_days: 7,
    });
  });
});

describe("STOP webhook plumbing", () => {
  it("computes and validates Twilio signatures", () => {
    const token = "test-auth-token";
    const url = "https://app.example.test/api/webhooks/twilio";
    const params = { From: "+15555550100", Body: "STOP", MessageSid: "SM123" };
    const sig = computeTwilioSignature(token, url, params);
    expect(validateTwilioSignature(token, url, params, sig)).toBe(true);
    expect(validateTwilioSignature(token, url, { ...params, Body: "START" }, sig)).toBe(false);
    expect(validateTwilioSignature(token, url, params, "not-the-signature")).toBe(false);
  });

  it("classifies Twilio's keyword set, case-insensitively", () => {
    expect(classifyInboundSms(" Stop ")).toBe("stop");
    expect(classifyInboundSms("UNSUBSCRIBE")).toBe("stop");
    expect(classifyInboundSms("start")).toBe("start");
    expect(classifyInboundSms("What time are you open?")).toBe("other");
  });

  it("finds clients by phone across orgs (client_by_phone policy) and flips consent", async () => {
    const phone = "+15555550777";
    const client = await makeClient({ displayName: "Stop Sender", phone, email: null });

    const matches = await findClientsByPhone(phone);
    expect(matches.some((m) => m.id === client.id && m.orgId === f.orgA)).toBe(true);

    await systemA.setClientSmsOptOut(client.id, true);
    expect((await scopeA.getClient(client.id))?.smsOptOutAt).toBeTruthy();
    await systemA.setClientSmsOptOut(client.id, false);
    expect((await scopeA.getClient(client.id))?.smsOptOutAt).toBeNull();
  });
});

describe("tenancy isolation (RLS) on M5 tables", () => {
  it("templates and messages never cross org scopes", async () => {
    const bTemplates = await scopeB.listMessageTemplates();
    expect(bTemplates).toHaveLength(0);

    const bMessages = await scopeB.listRecentMessages(100);
    expect(bMessages).toHaveLength(0);

    // Cross-org getters come back empty, not leaking existence.
    const aTemplate = templateIdsByName["Tax season kickoff"];
    expect(await scopeB.getMessageTemplate(aTemplate)).toBeNull();
  });

  it("FORCEd RLS hides rows from the app role without a tenant GUC", async () => {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      const templates = await c.query(`select count(*)::int as n from message_template`);
      expect(templates.rows[0].n).toBe(0);
      const messages = await c.query(`select count(*)::int as n from message`);
      expect(messages.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });
});
