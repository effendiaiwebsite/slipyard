import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { defaultOrgSettings, type OrgSettings } from "@/db/schema";
import {
  computeAuditRiskFindings,
  computeOptimizationFindings,
  type InsightInputs,
} from "@/lib/ai/insights";
import {
  AiDisabledError,
  askAssistant,
  draftClientEmail,
  narrateFindings,
  parseEmailDraft,
  prepareMeetingBrief,
} from "@/lib/ai/service";
import { runAiTool, scrubFreeText, AI_TOOLS, type AiToolContext } from "@/lib/ai/tools";
import { allowedInReadOnly, can, type Actor, type Role } from "@/lib/permissions";
import { adminUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M8 AI suite (ADR-0031/0032): permission-scoped read tools, redaction, the
 * mock engine (which exercises the SAME tool layer the real model uses),
 * ZERO write paths, ai_interaction logging + RLS, and the rule engines.
 */

// ---- pure units -------------------------------------------------------------

describe("scrubFreeText", () => {
  it("masks SIN-shaped digit runs in every common grouping", () => {
    expect(scrubFreeText("SIN is 123-456-789 ok")).toBe("SIN is [number removed] ok");
    expect(scrubFreeText("123 456 789")).toBe("[number removed]");
    expect(scrubFreeText("123456789")).toBe("[number removed]");
  });

  it("leaves ordinary numbers alone", () => {
    expect(scrubFreeText("Invoice INV-0001 for $932.25, tax year 2025")).toBe(
      "Invoice INV-0001 for $932.25, tax year 2025"
    );
    expect(scrubFreeText("call 416-555-0105")).toBe("call 416-555-0105");
  });
});

describe("parseEmailDraft", () => {
  it("splits the Subject: line from the body", () => {
    const d = parseEmailDraft("Subject: Hello Ruth\n\nHi Ruth,\n\nBest,\nSam");
    expect(d.subject).toBe("Hello Ruth");
    expect(d.body).toBe("Hi Ruth,\n\nBest,\nSam");
  });

  it("falls back to body-only when there is no subject line", () => {
    const d = parseEmailDraft("just text");
    expect(d.subject).toBe("");
    expect(d.body).toBe("just text");
  });
});

describe("permission matrix: ai.use", () => {
  const settings = defaultOrgSettings;
  it("every role may use AI; nobody keeps it in read-only grace mode", () => {
    for (const role of ["owner", "admin", "accountant", "clerk"] as Role[]) {
      const actor: Actor = { userId: "u", orgId: "o", role };
      expect(can(actor, "ai.use", undefined, settings)).toBe(true);
    }
    expect(allowedInReadOnly("ai.use")).toBe(false);
  });
});

// ---- rule engines (pure, ADR-0032) ------------------------------------------

const TODAY = new Date("2026-07-22T12:00:00Z");

function inputs(partial: Partial<InsightInputs>): InsightInputs {
  return {
    today: TODAY,
    reminderPolicyEnabled: true,
    clients: [],
    engagements: [],
    checklist: [],
    coverage: new Map(),
    problemDocuments: [],
    unbilledEntries: [],
    sentInvoices: [],
    ...partial,
  };
}

const clientRow = (id: string, over: Partial<InsightInputs["clients"][number]> = {}) => ({
  id,
  name: `Client ${id}`,
  type: "individual" as const,
  hasEmail: true,
  hasConsentedSms: true,
  sinOnFile: true,
  ...over,
});

const engRow = (
  id: string,
  clientId: string,
  over: Partial<InsightInputs["engagements"][number]> = {}
) => ({
  id,
  clientId,
  clientName: `Client ${clientId}`,
  type: "t1" as const,
  taxYear: 2025,
  stageLabel: "In preparation",
  stageCategory: "in_progress",
  enteredStageAt: TODAY,
  ...over,
});

describe("computeAuditRiskFindings", () => {
  it("flags filed returns with missing required docs as high severity", () => {
    const found = computeAuditRiskFindings(
      inputs({
        clients: [clientRow("c1")],
        coverage: new Map([["c1", { status: "active", expiringSoon: false }]]),
        engagements: [engRow("e1", "c1", { stageLabel: "Filed", stageCategory: "filed" })],
        checklist: [
          { engagementId: "e1", title: "Prior-year NOA", required: true, status: "missing" },
          { engagementId: "e1", title: "Optional thing", required: false, status: "missing" },
        ],
      })
    );
    expect(found.map((f) => f.rule)).toEqual(["filed-missing-docs"]);
    expect(found[0].severity).toBe("high");
    expect(found[0].summary).toContain("Prior-year NOA");
  });

  it("flags work without an active authorization, missing SIN, and stale stages", () => {
    const found = computeAuditRiskFindings(
      inputs({
        clients: [clientRow("c1", { sinOnFile: false })],
        coverage: new Map([["c1", { status: "none", expiringSoon: false }]]),
        engagements: [
          engRow("e1", "c1", { enteredStageAt: new Date("2026-01-01T00:00:00Z") }),
        ],
      })
    );
    const rules = found.map((f) => f.rule);
    expect(rules).toContain("no-authorization");
    expect(rules).toContain("missing-sin");
    expect(rules).toContain("stale-stage");
    // high before medium before low
    expect(rules[0]).toBe("no-authorization");
  });

  it("stays quiet when everything is in order", () => {
    const found = computeAuditRiskFindings(
      inputs({
        clients: [clientRow("c1")],
        coverage: new Map([["c1", { status: "active", expiringSoon: false }]]),
        engagements: [engRow("e1", "c1")],
        checklist: [
          { engagementId: "e1", title: "T4", required: true, status: "received" },
        ],
      })
    );
    expect(found).toEqual([]);
  });
});

describe("computeOptimizationFindings", () => {
  it("flags aged WIP, aged invoices, reminders off, unreachable and missing-season clients", () => {
    const found = computeOptimizationFindings(
      inputs({
        reminderPolicyEnabled: false,
        clients: [
          clientRow("c1"),
          clientRow("c2", { hasEmail: false, hasConsentedSms: false }),
        ],
        engagements: [
          engRow("e1", "c1", { stageCategory: "awaiting_docs" }),
          engRow("e2", "c2", { stageCategory: "awaiting_docs" }),
          // c2 has 2024 only → next rule sees them as having the 2025 season? No:
          // seasonYear = max(taxYear) = 2025; e2 is 2025 for c2, so give c2 2024.
        ],
        unbilledEntries: [
          { clientId: "c1", clientName: "Client c1", workDate: "2026-05-01", cents: 40000 },
          { clientId: "c1", clientName: "Client c1", workDate: "2026-07-20", cents: 10000 }, // fresh
        ],
        sentInvoices: [
          { clientName: "Client c1", number: 3, issueDate: "2026-05-15", totalCents: 93225 },
        ],
      })
    );
    const rules = found.map((f) => f.rule);
    expect(rules).toContain("aged-wip");
    expect(rules).toContain("aged-invoice");
    expect(rules).toContain("reminders-off");
    expect(rules).toContain("unreachable-client");
    const agedWip = found.find((f) => f.rule === "aged-wip")!;
    expect(agedWip.summary).toContain("$400.00"); // only the >30d entry counts
  });

  it("flags clients with no current-season return", () => {
    const found = computeOptimizationFindings(
      inputs({
        clients: [clientRow("c1"), clientRow("c2")],
        engagements: [engRow("e1", "c1", { taxYear: 2025 })],
      })
    );
    const missing = found.filter((f) => f.rule === "no-current-return");
    expect(missing).toHaveLength(1);
    expect(missing[0].clientId).toBe("c2");
  });
});

// ---- DB-backed: tools, scoping, redaction, zero writes, logging, RLS --------

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let assignedClient: string; // assigned to f.userA, has SIN + DOB + SIN-bearing note
let otherClient: string; // unassigned
let filedStageId: string;

const settings: OrgSettings = { ...defaultOrgSettings }; // assigned_only, ai on

function ctxFor(role: Role, over: Partial<AiToolContext> = {}): AiToolContext {
  return {
    scope: scopeA,
    orgId: f.orgA,
    orgName: "Test Org A",
    role,
    orgSettings: settings,
    user: { id: f.userA, name: "Test User A", email: `${f.userA}@test.local` },
    ...over,
  };
}

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  const awaiting = await scopeA.createStage({
    key: "awaiting-docs",
    label: "Waiting on documents",
    category: "awaiting_docs",
  });
  const filed = await scopeA.createStage({ key: "filed", label: "Filed", category: "filed" });
  filedStageId = filed.id;

  assignedClient = (
    await scopeA.createClient({
      type: "individual",
      displayName: "Ada Assigned",
      email: "ada@example.test",
      phone: "+14165550111",
      assignedAccountantId: f.userA,
      sinEncrypted: "not-a-real-ciphertext",
      sinLast3: "789",
      dateOfBirth: "1950-03-14",
      createdBy: f.userA,
    })
  ).id;
  otherClient = (
    await scopeA.createClient({
      type: "individual",
      displayName: "Omar Other",
      email: "omar@example.test",
      createdBy: f.userA,
    })
  ).id;

  await scopeA.addClientNote({
    clientId: assignedClient,
    body: "Client read out their SIN over the phone: 123-456-789. Prefers calls after 2pm.",
    pinned: true,
  });

  const e1 = await scopeA.createEngagement({
    clientId: assignedClient,
    type: "t1",
    taxYear: 2025,
    stageId: awaiting.id,
    assignedToId: f.userA,
  });
  await scopeA.addChecklistItem(e1.id, "Prior-year Notice of Assessment", true);

  // Omar: FILED with a required item still missing → audit-risk hit.
  const e2 = await scopeA.createEngagement({
    clientId: otherClient,
    type: "t1",
    taxYear: 2025,
    stageId: filedStageId,
  });
  await scopeA.addChecklistItem(e2.id, "T4 slips", true);
});

afterAll(async () => {
  await destroyFixture(f);
});

describe("AI tools: scoping", () => {
  it("assigned_only accountants see only their book in list tools", async () => {
    const asAccountant = await runAiTool(ctxFor("accountant"), "list_clients", {});
    const names = (asAccountant.result as { name: string }[]).map((c) => c.name);
    expect(names).toEqual(["Ada Assigned"]);

    const asClerk = await runAiTool(ctxFor("clerk"), "list_clients", {});
    expect((asClerk.result as unknown[]).length).toBe(2);
  });

  it("out-of-scope client lookups do not leak existence", async () => {
    const res = await runAiTool(ctxFor("accountant"), "get_client_overview", {
      clientId: otherClient,
    });
    expect((res.result as { error: string }).error).toMatch(/no client/i);
    // Same shape as a genuinely unknown id.
    const unknown = await runAiTool(ctxFor("accountant"), "get_client_overview", {
      clientId: "00000000-0000-4000-8000-000000000000",
    });
    expect((unknown.result as { error: string }).error).toMatch(/no client/i);
  });

  it("missing_documents narrows to the accountant's book", async () => {
    const asAccountant = await runAiTool(ctxFor("accountant"), "missing_documents", {});
    const clients = (asAccountant.result as { client: string }[]).map((r) => r.client);
    expect(clients).toEqual(["Ada Assigned"]);

    const asOwner = await runAiTool(ctxFor("owner"), "missing_documents", {});
    expect((asOwner.result as unknown[]).length).toBe(2);
  });

  it("unknown tools come back as an error result, not a throw", async () => {
    const res = await runAiTool(ctxFor("owner"), "drop_all_tables", {});
    expect((res.result as { error: string }).error).toContain("Unknown tool");
  });
});

describe("AI tools: redaction (no SIN / DOB to model APIs)", () => {
  it("no tool payload ever contains SIN, sin fields, or date of birth", async () => {
    const ctx = ctxFor("owner");
    for (const tool of AI_TOOLS) {
      const input =
        tool.name === "get_client_overview" ? { clientId: assignedClient } : {};
      const { result } = await runAiTool(ctx, tool.name, input);
      const json = JSON.stringify(result);
      expect(json, `${tool.name} leaked SIN`).not.toContain("123-456-789");
      expect(json, `${tool.name} leaked sin fields`).not.toMatch(/sinEncrypted|sinLast3|not-a-real-ciphertext/);
      expect(json, `${tool.name} leaked DOB`).not.toContain("1950-03-14");
      expect(json, `${tool.name} leaked raw email`).not.toContain("ada@example.test");
    }
  });

  it("free text is scrubbed but kept useful", async () => {
    const { result } = await runAiTool(ctxFor("owner"), "get_client_overview", {
      clientId: assignedClient,
    });
    const overview = result as { notes: { body: string }[]; client: { sinOnFile: boolean } };
    expect(overview.notes[0].body).toContain("[number removed]");
    expect(overview.notes[0].body).toContain("Prefers calls after 2pm");
    // The FACT that a SIN is on file is fine to share — the number is not.
    expect(overview.client.sinOnFile).toBe(true);
  });
});

describe("AiService (mock engine — same tool layer as the real one)", () => {
  it("ZERO write paths: a full run of every feature changes nothing but ai_interaction", async () => {
    const tables = [
      "client",
      "household",
      "engagement",
      "engagement_stage",
      "checklist_item",
      "client_note",
      "contact_log",
      "document",
      "message",
      "outbox",
      "cra_authorization",
      "time_entry",
      "invoice",
      "signature_request",
      "audit_log",
    ];
    const counts = async () => {
      const c = new Client({ connectionString: adminUrl() });
      await c.connect();
      try {
        const out: Record<string, number> = {};
        for (const t of tables) {
          const r = await c.query(`select count(*)::int as n from "${t}" where org_id = $1`, [
            f.orgA,
          ]);
          out[t] = r.rows[0].n;
        }
        return out;
      } finally {
        await c.end();
      }
    };

    const before = await counts();
    const ctx = ctxFor("owner");
    for (const tool of AI_TOOLS) {
      await runAiTool(ctx, tool.name, tool.name === "get_client_overview" ? { clientId: assignedClient } : {});
    }
    await askAssistant(ctx, "How does the pipeline look?");
    await draftClientEmail(ctx, { clientId: assignedClient, instructions: "nudge about documents" });
    await prepareMeetingBrief(ctx, assignedClient);
    await narrateFindings(ctx, "audit_risk", [
      { rule: "filed-missing-docs", severity: "high", client: "Omar Other", summary: "test" },
    ]);
    const after = await counts();

    expect(after).toEqual(before);
  });

  it("logs every run to ai_interaction with tools + model", async () => {
    const ctx = ctxFor("owner");
    const run = await askAssistant(ctx, "Who are we waiting on?");
    expect(run.model).toBe("mock");
    expect(run.toolsUsed.length).toBeGreaterThan(0);
    expect(run.toolsUsed.every((t) => typeof t.resultCount === "number")).toBe(true);

    const logged = await scopeA.listAiInteractions({ limit: 5 });
    const row = logged.find((r) => r.id === run.interactionId);
    expect(row).toBeTruthy();
    expect(row!.feature).toBe("assistant");
    expect(row!.prompt).toBe("Who are we waiting on?");
    expect(row!.response).toBe(run.text);
  });

  it("assistant answers respect role scoping — the accountant's snapshot is smaller", async () => {
    const clerkRun = await askAssistant(ctxFor("clerk"), "How does the pipeline look?");
    const accountantRun = await askAssistant(ctxFor("accountant"), "How does the pipeline look?");
    const num = (text: string) => Number(text.match(/Active clients in your view: (\d+)/)?.[1]);
    expect(num(clerkRun.text)).toBe(2);
    expect(num(accountantRun.text)).toBe(1);
  });

  it("email drafts ground in real data and DO NOT send", async () => {
    const ctx = ctxFor("owner");
    const run = await draftClientEmail(ctx, {
      clientId: assignedClient,
      instructions: "ask for what's still missing",
    });
    expect(run.draft.subject).toContain("2025 T1");
    expect(run.draft.body).toContain("Prior-year Notice of Assessment");
    expect(run.draft.body).toContain("Hello Ada");
    // No transport of any kind was created (also covered by the zero-write test).
    const c = new Client({ connectionString: adminUrl() });
    await c.connect();
    try {
      const msgs = await c.query(`select count(*)::int as n from message where org_id = $1`, [f.orgA]);
      const outbox = await c.query(`select count(*)::int as n from outbox where org_id = $1`, [f.orgA]);
      expect(msgs.rows[0].n).toBe(0);
      expect(outbox.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("the org AI toggle turns the whole service off", async () => {
    const ctx = ctxFor("owner", { orgSettings: { ...settings, ai_enabled: false } });
    await expect(askAssistant(ctx, "hello")).rejects.toBeInstanceOf(AiDisabledError);
    // ...and nothing was logged for the refused run.
    const logged = await scopeA.listAiInteractions({ limit: 50 });
    expect(logged.every((r) => r.prompt !== "hello")).toBe(true);
  });

  it("ai_interaction rows are tenant-isolated (RLS + scope)", async () => {
    const mine = await scopeA.listAiInteractions();
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await scopeB.listAiInteractions();
    expect(theirs).toEqual([]);
  });

  it("the usage viewer join resolves user names and stays tenant-isolated (M10)", async () => {
    const rows = await scopeA.listAiInteractionsWithUsers(10);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].userName).toBe("Test User A");
    // Newest first, same ordering contract as listAiInteractions.
    const times = rows.map((r) => r.interaction.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await scopeB.listAiInteractionsWithUsers(10)).toEqual([]);
  });
});
