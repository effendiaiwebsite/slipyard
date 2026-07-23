"use server";

import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/context";
import {
  computeAuditRiskFindings,
  computeOptimizationFindings,
  loadInsightInputs,
  type InsightFinding,
} from "@/lib/ai/insights";
import {
  AiDisabledError,
  aiContextFromStaff,
  askAssistant,
  draftClientEmail,
  narrateFindings,
  prepareMeetingBrief,
  type AiChatTurn,
} from "@/lib/ai/service";
import { sendClientMessage } from "@/lib/client-messaging";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { logger } from "@/lib/logger";
import { authorize, can, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * AI suite actions (M8, ADR-0031). Every AI run is authorized as `ai.use`
 * (audited) and logged to ai_interaction by the service. The ONLY action here
 * that touches the outside world is sendDraftedEmail — a plain M5 manual
 * send, authorized as messages.send_custom, that a human explicitly clicks
 * AFTER reviewing/editing the draft. The AI cannot reach it.
 */

async function authorizeAiUse(
  ctx: StaffContext,
  feature: string
): Promise<string | null> {
  try {
    await authorize(ctx.scope, ctx.actor, "ai.use", undefined, {
      readOnlyOrg: ctx.readOnly,
      orgSettings: ctx.orgSettings,
      details: { feature },
    });
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

function friendlyAiError(e: unknown): string {
  if (e instanceof AiDisabledError) return e.message;
  if (e instanceof Error && e.message.includes("too many steps")) return e.message;
  // The client only ever sees the generic line — but log the real cause, or
  // API/TLS/DB failures are undiagnosable from the outside (learned the hard
  // way when host antivirus intermittently MITM'd provider TLS).
  logger.error({ err: e instanceof Error ? (e.stack ?? e.message) : String(e) }, "ai run failed");
  return "The AI service is unavailable right now — try again in a moment.";
}

// ---- assistant --------------------------------------------------------------

const askSchema = z.object({
  question: z.string().min(1, "Ask a question first").max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(20)
    .default([]),
});

export async function askAssistantAction(
  question: string,
  history: AiChatTurn[]
): Promise<{ error?: string; text?: string }> {
  const parsed = askSchema.safeParse({ question, history });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireStaff();
  const denied = await authorizeAiUse(ctx, "assistant");
  if (denied) return { error: denied };
  try {
    const run = await askAssistant(aiContextFromStaff(ctx), parsed.data.question, parsed.data.history);
    return { text: run.text };
  } catch (e) {
    return { error: friendlyAiError(e) };
  }
}

// ---- email drafts -----------------------------------------------------------

const draftSchema = z.object({
  clientId: z.string().uuid(),
  instructions: z.string().min(1, "Tell the assistant what the email should say").max(2000),
});

export async function generateEmailDraft(
  clientId: string,
  instructions: string
): Promise<{ error?: string; subject?: string; body?: string }> {
  const parsed = draftSchema.safeParse({ clientId, instructions });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireStaff();
  const denied = await authorizeAiUse(ctx, "email_draft");
  if (denied) return { error: denied };
  try {
    const run = await draftClientEmail(aiContextFromStaff(ctx), parsed.data);
    return { subject: run.draft.subject, body: run.draft.body };
  } catch (e) {
    return { error: friendlyAiError(e) };
  }
}

const sendSchema = z.object({
  clientId: z.string().uuid(),
  subject: z.string().min(1, "Add a subject").max(300),
  body: z.string().min(1, "The email body is empty").max(20_000),
});

/**
 * The explicit human send. Deliberately NOT part of the AI service: separate
 * action, separate permission (messages.send_custom — clerk deny, accountant
 * assigned), and the staff member has seen and can edit every character.
 */
export async function sendDraftedEmail(
  clientId: string,
  subject: string,
  body: string
): Promise<{ error?: string; ok?: boolean; status?: string }> {
  const parsed = sendSchema.safeParse({ clientId, subject, body });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireStaff();

  const client = await ctx.scope.getClient(parsed.data.clientId);
  if (!client) return { error: "Client not found" };

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "messages.send_custom",
      {
        orgId: client.orgId,
        type: "client",
        id: client.id,
        assignedTo: client.assignedAccountantId,
      },
      {
        readOnlyOrg: ctx.readOnly,
        orgSettings: ctx.orgSettings,
        details: { op: "ai_draft_send", channel: "email" },
      }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }

  if (!client.email) {
    return { error: `${client.displayName} has no email address on file.` };
  }

  const message = await sendClientMessage(ctx.scope, {
    client,
    kind: "manual",
    requestedChannel: "email",
    subject: parsed.data.subject,
    body: parsed.data.body,
    contactSummary: `Emailed "${parsed.data.subject}"`,
  });
  if (message.status === "skipped") {
    return { error: "The message could not be sent (no usable address)." };
  }
  return { ok: true, status: message.status };
}

// ---- meeting prep -----------------------------------------------------------

export async function generateMeetingBrief(
  clientId: string
): Promise<{ error?: string; text?: string }> {
  if (!z.string().uuid().safeParse(clientId).success) return { error: "Pick a client first" };
  const ctx = await requireStaff();
  const denied = await authorizeAiUse(ctx, "meeting_prep");
  if (denied) return { error: denied };
  try {
    const run = await prepareMeetingBrief(aiContextFromStaff(ctx), clientId);
    return { text: run.text };
  } catch (e) {
    return { error: friendlyAiError(e) };
  }
}

// ---- audit risk / optimization ----------------------------------------------

/** Findings are recomputed server-side (never trusted from the client). */
export async function generateNarrative(
  feature: "audit_risk" | "optimize"
): Promise<{ error?: string; text?: string }> {
  if (feature !== "audit_risk" && feature !== "optimize") return { error: "Invalid feature" };
  const ctx = await requireStaff();
  const denied = await authorizeAiUse(ctx, feature);
  if (denied) return { error: denied };
  try {
    const aiCtx = aiContextFromStaff(ctx);
    const inputs = await loadInsightInputs(aiCtx, viewAssignedOnlyFilter(ctx));
    const findings: InsightFinding[] =
      feature === "audit_risk"
        ? computeAuditRiskFindings(inputs)
        : computeOptimizationFindings(inputs);
    const run = await narrateFindings(aiCtx, feature, findings);
    return { text: run.text };
  } catch (e) {
    return { error: friendlyAiError(e) };
  }
}
