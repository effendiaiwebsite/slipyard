import "server-only";
import { z } from "zod";
import type { OrgScope } from "@/db/scoped";
import type { OrgSettings } from "@/db/schema";
import { summarizeCoverage } from "@/lib/authorizations";
import { ENGAGEMENT_TYPE_LABELS, TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { can, type Action, type Role } from "@/lib/permissions";
import { entryAmountCents, formatCents } from "@/lib/timebilling";

/**
 * The AI read-tool registry (M8, ADR-0031) — the ONLY data surface the
 * AiService can reach, real model and mock alike.
 *
 * Safety properties, in order of importance:
 *  - READ-ONLY BY CONSTRUCTION: no tool calls any OrgScope mutation. AI
 *    cannot write records because no write exists here to call.
 *  - PERMISSION-SCOPED: every tool declares the view Action it needs; the
 *    executor checks can() for the calling role, and list tools narrow to
 *    assigned clients for assigned_only accountants (viewAssignedOnlyFilter).
 *  - REDACTED: payloads are built field-by-field — sin_encrypted, sin_last3,
 *    date_of_birth, addresses, raw email/phone values and custom_fields are
 *    never selected into a tool result. Free text staff typed (notes,
 *    contact summaries) additionally passes scrubFreeText(), which masks
 *    SIN-shaped digit runs — belt and braces for the "no SIN to model APIs"
 *    iron rule.
 */

export type AiToolContext = {
  scope: OrgScope;
  orgId: string;
  orgName: string;
  role: Role;
  orgSettings: OrgSettings;
  user: { id: string; name: string; email: string };
};

/** 9 digits in the 3-3-3 SIN grouping (or unbroken) inside free text. */
const SIN_LIKE = /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g;

/** Mask SIN-shaped digit runs in staff-typed free text before it reaches a prompt. */
export function scrubFreeText(text: string): string {
  return text.replace(SIN_LIKE, "[number removed]");
}

function assignedOnlyFilter(ctx: AiToolContext): string | undefined {
  return viewAssignedOnlyFilter({
    role: ctx.role,
    orgSettings: ctx.orgSettings,
    user: ctx.user,
  });
}

type AiToolDef<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  /** View permission the CALLER must hold for this tool to run. */
  requires: Action;
  inputSchema: S;
  run: (ctx: AiToolContext, input: z.infer<S>) => Promise<unknown>;
};

function defineTool<S extends z.ZodTypeAny>(tool: AiToolDef<S>): AiToolDef<z.ZodTypeAny> {
  return tool as AiToolDef<z.ZodTypeAny>;
}

const listClients = defineTool({
  name: "list_clients",
  description:
    "List the firm's clients the current user may see: name, type, status, tags, assigned accountant, latest return (type/year/stage) and last contact date. Optional case-insensitive name search via `q`.",
  requires: "clients.view",
  inputSchema: z.object({
    q: z.string().max(100).optional().describe("Name search, e.g. a first or last name"),
    type: z.enum(["individual", "corporation", "trust"]).optional(),
    status: z.enum(["active", "archived"]).default("active"),
  }),
  run: async (ctx, input) => {
    const rows = await ctx.scope.listClientsWithMeta({
      q: input.q,
      type: input.type,
      status: input.status,
      assignedToId: assignedOnlyFilter(ctx),
    });
    return rows.slice(0, 100).map((r) => ({
      id: r.client.id,
      name: r.client.displayName,
      type: TYPE_LABELS[r.client.type],
      status: r.client.status,
      tags: r.client.tags ?? [],
      preferredChannel: r.client.preferredChannel,
      hasEmail: !!r.client.email,
      hasPhone: !!r.client.phone,
      smsOptedOut: !!r.client.smsOptOutAt,
      assignedAccountant: r.assignedName,
      household: r.householdName,
      latestReturn: r.latestEngagement
        ? {
            type: ENGAGEMENT_TYPE_LABELS[r.latestEngagement.engagement.type],
            taxYear: r.latestEngagement.engagement.taxYear,
            stage: r.latestEngagement.stage.label,
            stageCategory: r.latestEngagement.stage.category,
          }
        : null,
      lastContactAt: r.lastContactAt,
    }));
  },
});

const getClientOverview = defineTool({
  name: "get_client_overview",
  description:
    "Everything on file for ONE client: profile summary, household, notes, recent contact history, every return with its stage and checklist state, and CRA authorization coverage. Look up by client id (from list_clients) or by name.",
  requires: "clients.view",
  inputSchema: z.object({
    clientId: z.string().uuid().optional(),
    name: z.string().max(100).optional().describe("Used when no id is known"),
  }),
  run: async (ctx, input) => {
    const assignedTo = assignedOnlyFilter(ctx);
    let clientId = input.clientId ?? null;
    if (!clientId) {
      if (!input.name) return { error: "Provide clientId or name." };
      const matches = await ctx.scope.listClientsWithMeta({
        q: input.name,
        assignedToId: assignedTo,
      });
      if (matches.length === 0) return { error: `No client named "${input.name}" in your scope.` };
      if (matches.length > 1) {
        return {
          error: "Multiple matches — ask which one or use the id.",
          candidates: matches.slice(0, 10).map((m) => ({ id: m.client.id, name: m.client.displayName })),
        };
      }
      clientId = matches[0].client.id;
    }

    const detail = await ctx.scope.getClientDetail(clientId);
    // Assigned-only accountants get the same no-existence-leak answer the UI
    // gives (M2 posture): out-of-scope looks identical to not-found.
    if (!detail || (assignedTo && detail.client.assignedAccountantId !== assignedTo)) {
      return { error: "No client with that id in your scope." };
    }

    const [itemRows, authRows] = await Promise.all([
      ctx.scope.listChecklistItemsForClient(clientId),
      ctx.scope.listAuthorizationsForClient(clientId),
    ]);
    const coverage = summarizeCoverage(authRows, new Date());
    const items = itemRows.map((r) => r.item);
    const itemsByEngagement = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByEngagement.get(item.engagementId) ?? [];
      list.push(item);
      itemsByEngagement.set(item.engagementId, list);
    }

    return {
      client: {
        id: detail.client.id,
        name: detail.client.displayName,
        type: TYPE_LABELS[detail.client.type],
        status: detail.client.status,
        tags: detail.client.tags ?? [],
        preferredChannel: detail.client.preferredChannel,
        hasEmail: !!detail.client.email,
        hasPhone: !!detail.client.phone,
        smsOptedOut: !!detail.client.smsOptOutAt,
        sinOnFile: !!detail.client.sinEncrypted,
        assignedAccountant: detail.assignedName,
        household: detail.householdName,
        householdMembers: detail.householdMembers.map((m) => m.displayName),
      },
      notes: detail.notes.slice(0, 20).map((n) => ({
        pinned: n.note.pinned,
        author: n.authorName,
        date: n.note.createdAt,
        body: scrubFreeText(n.note.body),
      })),
      recentContacts: detail.contacts.slice(0, 15).map((c) => ({
        channel: c.entry.channel,
        date: c.entry.occurredAt,
        by: c.byName,
        summary: scrubFreeText(c.entry.summary),
      })),
      returns: detail.engagements.map((e) => {
        const list = itemsByEngagement.get(e.engagement.id) ?? [];
        return {
          id: e.engagement.id,
          type: ENGAGEMENT_TYPE_LABELS[e.engagement.type],
          taxYear: e.engagement.taxYear,
          stage: e.stage.label,
          stageCategory: e.stage.category,
          assignedTo: e.assignedName,
          checklist: {
            total: list.length,
            requiredMissing: list
              .filter((i) => i.required && i.status === "missing")
              .map((i) => i.title),
            waived: list.filter((i) => i.status === "waived").map((i) => i.title),
          },
        };
      }),
      craAuthorization: {
        coverage: coverage.status,
        expiringSoon: coverage.expiringSoon,
        level: coverage.row?.level ?? null,
        expiryDate: coverage.row?.expiryDate ?? null,
      },
    };
  },
});

const pipelineSummary = defineTool({
  name: "pipeline_summary",
  description:
    "The firm's workflow pipeline right now: engagement counts per stage (in board order) and return counts by type and tax year. Assigned-only accountants see their own book.",
  requires: "engagements.view",
  inputSchema: z.object({}),
  run: async (ctx) => {
    const assignedTo = assignedOnlyFilter(ctx);
    const [stages, byStage, clients] = await Promise.all([
      ctx.scope.listStages(),
      ctx.scope.countEngagementsByStage(assignedTo),
      ctx.scope.listClientsWithMeta({ status: "active", assignedToId: assignedTo }),
    ]);
    const engagements = await ctx.scope.listEngagementsForClients(
      clients.map((c) => c.client.id)
    );
    const byTypeYear = new Map<string, number>();
    for (const { engagement } of engagements) {
      const key = `${ENGAGEMENT_TYPE_LABELS[engagement.type]} ${engagement.taxYear}`;
      byTypeYear.set(key, (byTypeYear.get(key) ?? 0) + 1);
    }
    return {
      activeClients: clients.length,
      stages: stages.map((s) => ({
        stage: s.label,
        category: s.category,
        count: byStage.get(s.id) ?? 0,
      })),
      returnsByTypeYear: [...byTypeYear.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ label, count })),
    };
  },
});

const missingDocuments = defineTool({
  name: "missing_documents",
  description:
    "Which clients still owe documents: every still-missing REQUIRED checklist item, grouped per client and return. Use this for reminder drafting and 'who are we waiting on' questions.",
  requires: "documents.view",
  inputSchema: z.object({}),
  run: async (ctx) => {
    const assignedTo = assignedOnlyFilter(ctx);
    const clients = await ctx.scope.listClientsWithMeta({
      status: "active",
      assignedToId: assignedTo,
    });
    const engagements = await ctx.scope.listEngagementsForClients(
      clients.map((c) => c.client.id)
    );
    const items = await ctx.scope.listChecklistItemsForEngagements(
      engagements.map((e) => e.engagement.id)
    );
    const byEngagement = new Map<string, string[]>();
    for (const item of items) {
      if (!item.required || item.status !== "missing") continue;
      const list = byEngagement.get(item.engagementId) ?? [];
      list.push(item.title);
      byEngagement.set(item.engagementId, list);
    }
    return engagements
      .filter((e) => (byEngagement.get(e.engagement.id) ?? []).length > 0)
      .map((e) => ({
        client: e.clientName,
        clientId: e.engagement.clientId,
        return: `${ENGAGEMENT_TYPE_LABELS[e.engagement.type]} ${e.engagement.taxYear}`,
        stage: e.stage.label,
        stageCategory: e.stage.category,
        missingRequired: byEngagement.get(e.engagement.id) ?? [],
      }));
  },
});

const authorizationCoverage = defineTool({
  name: "authorization_coverage",
  description:
    "CRA authorization coverage per active client: one verdict each (active / pending / expired / revoked / none, expiring-soon flagged) plus firm totals. Expiry is derived — an active record past its expiry date counts as expired.",
  requires: "authorizations.view",
  inputSchema: z.object({}),
  run: async (ctx) => {
    const assignedTo = assignedOnlyFilter(ctx);
    const [clients, authRows] = await Promise.all([
      ctx.scope.listClientsWithMeta({ status: "active", assignedToId: assignedTo }),
      ctx.scope.listAuthorizations(assignedTo ? { assignedToId: assignedTo } : undefined),
    ]);
    const today = new Date();
    const byClient = new Map<string, (typeof authRows)[number]["auth"][]>();
    for (const row of authRows) {
      const list = byClient.get(row.auth.clientId) ?? [];
      list.push(row.auth);
      byClient.set(row.auth.clientId, list);
    }
    const perClient = clients.map((c) => {
      const coverage = summarizeCoverage(byClient.get(c.client.id) ?? [], today);
      return {
        client: c.client.displayName,
        clientId: c.client.id,
        coverage: coverage.status,
        expiringSoon: coverage.expiringSoon,
        expiryDate: coverage.row?.expiryDate ?? null,
      };
    });
    return {
      totals: {
        clients: perClient.length,
        covered: perClient.filter((c) => c.coverage === "active").length,
        pending: perClient.filter((c) => c.coverage === "pending").length,
        uncovered: perClient.filter(
          (c) => c.coverage !== "active" && c.coverage !== "pending"
        ).length,
      },
      clients: perClient,
    };
  },
});

const billingSummary = defineTool({
  name: "billing_summary",
  description:
    "Time & billing snapshot: unbilled work-in-progress per client (hours and dollars), plus invoice totals outstanding and paid. Amounts are CAD.",
  requires: "invoices.view",
  inputSchema: z.object({}),
  run: async (ctx) => {
    const assignedTo = assignedOnlyFilter(ctx);
    const opts = assignedTo ? { assignedToId: assignedTo } : undefined;
    const [timeEntries, invoices] = await Promise.all([
      ctx.scope.listTimeEntries({ ...(opts ?? {}), limit: 5000 }),
      ctx.scope.listInvoices(opts),
    ]);
    const wipByClient = new Map<string, { minutes: number; cents: number }>();
    for (const r of timeEntries) {
      if (r.entry.invoiceId) continue;
      const agg = wipByClient.get(r.clientName) ?? { minutes: 0, cents: 0 };
      agg.minutes += r.entry.minutes;
      agg.cents += entryAmountCents(r.entry);
      wipByClient.set(r.clientName, agg);
    }
    const totalWipCents = [...wipByClient.values()].reduce((s, v) => s + v.cents, 0);
    return {
      unbilledWip: {
        total: formatCents(totalWipCents),
        byClient: [...wipByClient.entries()]
          .sort((a, b) => b[1].cents - a[1].cents)
          .map(([client, v]) => ({
            client,
            hours: Math.round((v.minutes / 60) * 10) / 10,
            amount: formatCents(v.cents),
          })),
      },
      invoices: {
        outstanding: formatCents(
          invoices
            .filter((r) => r.invoice.status === "sent")
            .reduce((s, r) => s + r.invoice.totalCents, 0)
        ),
        paid: formatCents(
          invoices
            .filter((r) => r.invoice.status === "paid")
            .reduce((s, r) => s + r.invoice.totalCents, 0)
        ),
        issued: invoices.filter((r) => r.invoice.status !== "draft").length,
      },
    };
  },
});

export const AI_TOOLS: readonly AiToolDef<z.ZodTypeAny>[] = [
  listClients,
  getClientOverview,
  pipelineSummary,
  missingDocuments,
  authorizationCoverage,
  billingSummary,
];

export type AiToolResult = {
  /** JSON-safe tool output (or `{ error }` the model can react to). */
  result: unknown;
  /** Rows/items in the result — logged to ai_interaction, never the data. */
  resultCount: number;
};

function countResult(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    for (const key of ["clients", "returns", "stages"]) {
      if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length;
    }
    if ("error" in obj) return 0;
  }
  return 1;
}

/**
 * The single executor both engines use. Permission failures and bad inputs
 * come back AS TOOL RESULTS (never throws for those) so the model can adjust
 * instead of crashing the run.
 */
export async function runAiTool(
  ctx: AiToolContext,
  name: string,
  rawInput: unknown
): Promise<AiToolResult> {
  const tool = AI_TOOLS.find((t) => t.name === name);
  if (!tool) return { result: { error: `Unknown tool: ${name}` }, resultCount: 0 };
  const actor = { userId: ctx.user.id, orgId: ctx.orgId, role: ctx.role };
  // The resource ref marks the query as self-assigned so 'assigned' rules
  // (accountants in assigned_only orgs) pass here — the tools themselves
  // narrow every list to the caller's book via viewAssignedOnlyFilter.
  const selfScoped = { orgId: ctx.orgId, type: "ai_tool", assignedTo: ctx.user.id };
  if (!can(actor, tool.requires, selfScoped, ctx.orgSettings)) {
    return {
      result: { error: `Your role (${ctx.role}) does not have access to ${tool.requires}.` },
      resultCount: 0,
    };
  }
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      result: { error: `Invalid input: ${parsed.error.issues[0]?.message ?? "bad input"}` },
      resultCount: 0,
    };
  }
  const result = await tool.run(ctx, parsed.data);
  return { result, resultCount: countResult(result) };
}
