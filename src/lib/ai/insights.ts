import { reminderSettings } from "@/db/schema";
import { summarizeCoverage } from "@/lib/authorizations";
import { ENGAGEMENT_TYPE_LABELS } from "@/lib/clients";
import { entryAmountCents, formatCents } from "@/lib/timebilling";
import type { AiToolContext } from "./tools";

/**
 * Audit-risk & optimization rule engines (M8, ADR-0032). The findings are
 * PURE deterministic derivations over practice data — the AI only narrates
 * them. This module never talks to a model and never writes anything.
 *
 * "Audit risk" here is PRACTICE risk (this CRM has no return amounts — it
 * sits beside the EFILE software): filings with missing paperwork, filings
 * without CRA authority, quarantined uploads, stale work.
 */

export type InsightFinding = {
  /** Stable rule id, shown beside the narrative (ADR-0032). */
  rule: string;
  severity: "high" | "medium" | "low";
  clientId?: string;
  client?: string;
  summary: string;
};

export type InsightInputs = {
  today: Date;
  reminderPolicyEnabled: boolean;
  clients: {
    id: string;
    name: string;
    type: "individual" | "corporation" | "trust";
    hasEmail: boolean;
    hasConsentedSms: boolean;
    sinOnFile: boolean;
  }[];
  engagements: {
    id: string;
    clientId: string;
    clientName: string;
    type: "t1" | "t2" | "t3" | "other";
    taxYear: number;
    stageLabel: string;
    stageCategory: string;
    /** When the engagement entered its current stage (falls back to createdAt). */
    enteredStageAt: Date;
  }[];
  checklist: { engagementId: string; title: string; required: boolean; status: string }[];
  /** One coverage verdict per client (summarizeCoverage output status). */
  coverage: Map<string, { status: string; expiringSoon: boolean }>;
  problemDocuments: { clientId: string; clientName: string; filename: string; status: string }[];
  unbilledEntries: { clientId: string; clientName: string; workDate: string; cents: number }[];
  sentInvoices: { clientName: string; number: number; issueDate: string; totalCents: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_STAGE_DAYS = 45;
export const AGED_WIP_DAYS = 30;
export const AGED_INVOICE_DAYS = 30;

function daysAgo(date: Date | string, today: Date): number {
  const t = typeof date === "string" ? new Date(`${date}T12:00:00Z`).getTime() : date.getTime();
  return Math.floor((today.getTime() - t) / DAY_MS);
}

function label(e: InsightInputs["engagements"][number]): string {
  return `${ENGAGEMENT_TYPE_LABELS[e.type]} ${e.taxYear}`;
}

/** Practice-risk findings, highest severity first (deterministic order). */
export function computeAuditRiskFindings(inputs: InsightInputs): InsightFinding[] {
  const findings: InsightFinding[] = [];
  const itemsByEngagement = new Map<string, InsightInputs["checklist"]>();
  for (const item of inputs.checklist) {
    const list = itemsByEngagement.get(item.engagementId) ?? [];
    list.push(item);
    itemsByEngagement.set(item.engagementId, list);
  }

  for (const e of inputs.engagements) {
    const filedOrDone = e.stageCategory === "filed" || e.stageCategory === "complete";
    const items = itemsByEngagement.get(e.id) ?? [];
    const missingRequired = items.filter((i) => i.required && i.status === "missing");
    const waivedRequired = items.filter((i) => i.required && i.status === "waived");

    if (filedOrDone && missingRequired.length > 0) {
      findings.push({
        rule: "filed-missing-docs",
        severity: "high",
        clientId: e.clientId,
        client: e.clientName,
        summary: `${label(e)} is ${e.stageLabel} but ${missingRequired.length} required document(s) were never received: ${missingRequired.map((i) => i.title).join(", ")}.`,
      });
    }
    if (filedOrDone && waivedRequired.length > 0) {
      findings.push({
        rule: "filed-waived-docs",
        severity: "medium",
        clientId: e.clientId,
        client: e.clientName,
        summary: `${label(e)} was filed with required item(s) marked not-needed: ${waivedRequired.map((i) => i.title).join(", ")}. Confirm the waiver was deliberate.`,
      });
    }
    if (
      (e.stageCategory === "in_progress" || e.stageCategory === "awaiting_signature") &&
      daysAgo(e.enteredStageAt, inputs.today) > STALE_STAGE_DAYS
    ) {
      findings.push({
        rule: "stale-stage",
        severity: "low",
        clientId: e.clientId,
        client: e.clientName,
        summary: `${label(e)} has sat in "${e.stageLabel}" for ${daysAgo(e.enteredStageAt, inputs.today)} days.`,
      });
    }
  }

  // Clients with returns in motion but no usable CRA authorization.
  const clientsWithWork = new Set(inputs.engagements.map((e) => e.clientId));
  for (const c of inputs.clients) {
    if (!clientsWithWork.has(c.id)) continue;
    const cov = inputs.coverage.get(c.id) ?? { status: "none", expiringSoon: false };
    if (cov.status !== "active" && cov.status !== "pending") {
      findings.push({
        rule: "no-authorization",
        severity: "high",
        clientId: c.id,
        client: c.name,
        summary: `Returns are in motion but the firm holds no active CRA authorization (status: ${cov.status}).`,
      });
    } else if (cov.status === "active" && cov.expiringSoon) {
      findings.push({
        rule: "authorization-expiring",
        severity: "medium",
        clientId: c.id,
        client: c.name,
        summary: "CRA authorization is active but expires within 90 days — renew before the season ends.",
      });
    }
    if (c.type === "individual" && !c.sinOnFile) {
      findings.push({
        rule: "missing-sin",
        severity: "medium",
        clientId: c.id,
        client: c.name,
        summary: "Individual client with returns in motion but no SIN on file.",
      });
    }
  }

  for (const d of inputs.problemDocuments) {
    findings.push({
      rule: "quarantined-document",
      severity: d.status === "infected" ? "high" : "medium",
      clientId: d.clientId,
      client: d.clientName,
      summary:
        d.status === "infected"
          ? `Uploaded file "${d.filename}" was flagged by the virus scanner and is quarantined.`
          : `Uploaded file "${d.filename}" failed scanning and needs a rescan.`,
    });
  }

  return sortFindings(findings);
}

/** Practice-operations opportunities, deterministic order. */
export function computeOptimizationFindings(inputs: InsightInputs): InsightFinding[] {
  const findings: InsightFinding[] = [];

  // Aged unbilled WIP per client.
  const agedByClient = new Map<string, { name: string; cents: number }>();
  for (const entry of inputs.unbilledEntries) {
    if (daysAgo(entry.workDate, inputs.today) <= AGED_WIP_DAYS) continue;
    const agg = agedByClient.get(entry.clientId) ?? { name: entry.clientName, cents: 0 };
    agg.cents += entry.cents;
    agedByClient.set(entry.clientId, agg);
  }
  for (const [clientId, agg] of agedByClient) {
    findings.push({
      rule: "aged-wip",
      severity: "medium",
      clientId,
      client: agg.name,
      summary: `${formatCents(agg.cents)} of unbilled work is over ${AGED_WIP_DAYS} days old — consider invoicing.`,
    });
  }

  for (const inv of inputs.sentInvoices) {
    const age = daysAgo(inv.issueDate, inputs.today);
    if (age > AGED_INVOICE_DAYS) {
      findings.push({
        rule: "aged-invoice",
        severity: "medium",
        client: inv.clientName,
        summary: `Invoice INV-${String(inv.number).padStart(4, "0")} (${formatCents(inv.totalCents)}) has been outstanding ${age} days.`,
      });
    }
  }

  // Clients with no engagement for the current season (latest tax year in play).
  const seasonYear = inputs.engagements.reduce((max, e) => Math.max(max, e.taxYear), 0);
  if (seasonYear > 0) {
    const withSeason = new Set(
      inputs.engagements.filter((e) => e.taxYear === seasonYear).map((e) => e.clientId)
    );
    for (const c of inputs.clients) {
      if (!withSeason.has(c.id)) {
        findings.push({
          rule: "no-current-return",
          severity: "low",
          clientId: c.id,
          client: c.name,
          summary: `No ${seasonYear} return has been opened yet.`,
        });
      }
    }
  }

  // Reminder policy off while awaiting_docs work piles up.
  if (!inputs.reminderPolicyEnabled) {
    const waiting = inputs.engagements.filter((e) => e.stageCategory === "awaiting_docs").length;
    if (waiting >= 2) {
      findings.push({
        rule: "reminders-off",
        severity: "medium",
        summary: `${waiting} returns are waiting on client documents but automatic reminders are turned off (Settings → Templates).`,
      });
    }
  }

  // Clients messaging can't reach at all.
  for (const c of inputs.clients) {
    if (!c.hasEmail && !c.hasConsentedSms) {
      findings.push({
        rule: "unreachable-client",
        severity: "low",
        clientId: c.id,
        client: c.name,
        summary: "No email and no textable phone on file — reminders and portal links cannot reach them.",
      });
    }
  }

  return sortFindings(findings);
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function sortFindings(findings: InsightFinding[]): InsightFinding[] {
  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      (a.client ?? "").localeCompare(b.client ?? "")
  );
}

/**
 * Load the rule inputs through the SAME scoping the AI tools use: assigned-
 * only accountants compute findings over their own book only.
 */
export async function loadInsightInputs(
  ctx: AiToolContext,
  assignedToId: string | undefined
): Promise<InsightInputs> {
  const opts = assignedToId ? { assignedToId } : undefined;
  const [clients, authRows, problemDocs, timeEntries, invoices] = await Promise.all([
    ctx.scope.listClientsWithMeta({ status: "active", assignedToId }),
    ctx.scope.listAuthorizations(opts),
    ctx.scope.listProblemDocuments(opts),
    ctx.scope.listTimeEntries({ ...(opts ?? {}), unbilledOnly: true, limit: 5000 }),
    ctx.scope.listInvoices(opts),
  ]);
  const engagements = await ctx.scope.listEngagementsForClients(clients.map((c) => c.client.id));
  const checklist = await ctx.scope.listChecklistItemsForEngagements(
    engagements.map((e) => e.engagement.id)
  );

  const today = new Date();
  const authsByClient = new Map<string, (typeof authRows)[number]["auth"][]>();
  for (const row of authRows) {
    const list = authsByClient.get(row.auth.clientId) ?? [];
    list.push(row.auth);
    authsByClient.set(row.auth.clientId, list);
  }
  const coverage = new Map<string, { status: string; expiringSoon: boolean }>();
  for (const c of clients) {
    const cov = summarizeCoverage(authsByClient.get(c.client.id) ?? [], today);
    coverage.set(c.client.id, { status: cov.status, expiringSoon: cov.expiringSoon });
  }

  return {
    today,
    reminderPolicyEnabled: reminderSettings(ctx.orgSettings).enabled,
    clients: clients.map((c) => ({
      id: c.client.id,
      name: c.client.displayName,
      type: c.client.type,
      hasEmail: !!c.client.email,
      hasConsentedSms: !!c.client.phone && !c.client.smsOptOutAt,
      sinOnFile: !!c.client.sinEncrypted,
    })),
    engagements: engagements.map((e) => {
      const entered = e.engagement.statusTimestamps?.[e.stage.key];
      return {
        id: e.engagement.id,
        clientId: e.engagement.clientId,
        clientName: e.clientName,
        type: e.engagement.type,
        taxYear: e.engagement.taxYear,
        stageLabel: e.stage.label,
        stageCategory: e.stage.category,
        enteredStageAt: entered ? new Date(entered) : e.engagement.createdAt,
      };
    }),
    checklist: checklist.map((i) => ({
      engagementId: i.engagementId,
      title: i.title,
      required: i.required,
      status: i.status,
    })),
    coverage,
    problemDocuments: problemDocs.map((d) => ({
      clientId: d.clientId,
      clientName: d.clientName,
      filename: d.filename,
      status: d.status,
    })),
    unbilledEntries: timeEntries.map((r) => ({
      clientId: r.entry.clientId,
      clientName: r.clientName,
      workDate: r.entry.workDate,
      cents: entryAmountCents(r.entry),
    })),
    sentInvoices: invoices
      .filter((r) => r.invoice.status === "sent")
      .map((r) => ({
        clientName: r.clientName,
        number: r.invoice.number,
        issueDate: r.invoice.issueDate,
        totalCents: r.invoice.totalCents,
      })),
  };
}
