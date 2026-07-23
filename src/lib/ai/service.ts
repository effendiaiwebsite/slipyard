import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AiFeatureName, AiToolUse } from "@/db/schema";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AI_TOOLS, runAiTool, scrubFreeText, type AiToolContext } from "./tools";

/**
 * AiService (M8, ADR-0031): one service, two engines.
 *
 *  - REAL (ANTHROPIC_API_KEY set): claude-opus-4-8 in a bounded tool-use loop
 *    over the read-only registry in ./tools.
 *  - MOCK (no key — the dev/test default): a deterministic script per feature
 *    that calls the SAME tools through the SAME executor and renders their
 *    results as text. Scoping and redaction are tool-layer properties, so
 *    they hold identically in both engines.
 *
 * DRAFTS ONLY: this module returns text and logs to ai_interaction. It sends
 * nothing, stores nothing on client records, and classifies nothing.
 */

export const AI_MODEL = "claude-opus-4-8";
export const MOCK_MODEL = "mock";
const MAX_TOOL_ITERATIONS = 8;

export class AiDisabledError extends Error {
  constructor() {
    super("AI features are turned off for this firm (Settings → Firm profile).");
    this.name = "AiDisabledError";
  }
}

export type AiChatTurn = { role: "user" | "assistant"; content: string };

export type AiRunResult = {
  text: string;
  toolsUsed: AiToolUse[];
  model: string;
  interactionId: string;
};

function baseSystemPrompt(ctx: AiToolContext): string {
  return [
    `You are the built-in assistant of the practice CRM used by ${ctx.orgName}, a Canadian accounting firm. Today is ${new Date().toISOString().slice(0, 10)}.`,
    `You are talking to ${ctx.user.name} (role: ${ctx.role}).`,
    "You have READ-ONLY tools over the firm's CRM data. You cannot create, change, send, or file anything — never claim to have taken an action; instead point to where the user can do it in the app.",
    "Ground every factual statement in tool results from this conversation. If the tools don't show it, say you don't know.",
    "Never include Social Insurance Numbers or dates of birth in your answers, even if asked.",
    "This is practice-management data only — you never give tax or legal advice, just what's on file.",
  ].join("\n");
}

/** Everything a feature run needs besides the engine. */
type RunSpec = {
  ctx: AiToolContext;
  feature: AiFeatureName;
  /** What gets logged as the prompt (the staff member's input). */
  prompt: string;
  /** Full conversation for the model (assistant history included). */
  turns: AiChatTurn[];
  systemExtra?: string;
  /** Deterministic engine used when no API key is configured. */
  mock: (ctx: AiToolContext, callTool: MockToolCaller) => Promise<string>;
};

type MockToolCaller = (name: string, input?: unknown) => Promise<unknown>;

async function runFeature(spec: RunSpec): Promise<AiRunResult> {
  const { ctx } = spec;
  if (!ctx.orgSettings.ai_enabled) throw new AiDisabledError();

  const toolsUsed: AiToolUse[] = [];
  const record = (tool: string, resultCount: number) => {
    toolsUsed.push({ tool, resultCount });
  };

  let text: string;
  let model: string;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  if (features.realAi) {
    const real = await runRealEngine(spec, record);
    text = real.text;
    model = AI_MODEL;
    inputTokens = real.inputTokens;
    outputTokens = real.outputTokens;
  } else {
    const callTool: MockToolCaller = async (name, input) => {
      const { result, resultCount } = await runAiTool(ctx, name, input ?? {});
      record(name, resultCount);
      return result;
    };
    text = await spec.mock(ctx, callTool);
    model = MOCK_MODEL;
  }

  const interaction = await ctx.scope.createAiInteraction({
    userId: ctx.user.id,
    feature: spec.feature,
    prompt: spec.prompt,
    response: text,
    toolsUsed,
    model,
    inputTokens,
    outputTokens,
  });
  logger.info(
    { feature: spec.feature, model, tools: toolsUsed.length, interactionId: interaction.id },
    "ai run complete"
  );
  return { text, toolsUsed, model, interactionId: interaction.id };
}

/**
 * Real engine: bounded manual tool-use loop (no beta dependency). Adaptive
 * thinking; thinking blocks are echoed back unchanged each iteration.
 */
async function runRealEngine(
  spec: RunSpec,
  record: (tool: string, resultCount: number) => void
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const tools: Anthropic.Tool[] = AI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.inputSchema) as Anthropic.Tool.InputSchema,
  }));
  const system = [baseSystemPrompt(spec.ctx), spec.systemExtra].filter(Boolean).join("\n\n");
  const messages: Anthropic.MessageParam[] = spec.turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  let inputTokens = 0;
  let outputTokens = 0;
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      tools,
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { text, inputTokens, outputTokens };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { result, resultCount } = await runAiTool(spec.ctx, block.name, block.input);
      record(block.name, resultCount);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("The AI assistant took too many steps — try a more specific question.");
}

// ---- feature entry points ---------------------------------------------------

/** Knowledge assistant chat. History is prior turns; `question` is the new one. */
export async function askAssistant(
  ctx: AiToolContext,
  question: string,
  history: AiChatTurn[] = []
): Promise<AiRunResult> {
  return runFeature({
    ctx,
    feature: "assistant",
    prompt: question,
    turns: [...history, { role: "user", content: question }],
    systemExtra:
      "Answer practice questions concisely. When listing clients or returns, prefer short bullet lists. Suggest the relevant app page (Clients, Returns, Messaging, Billing, Reports) when the user should act.",
    mock: async (mockCtx, callTool) => {
      // Deterministic: if the question names a client we can find, brief on
      // them; otherwise render a practice snapshot. Same tools either way.
      const nameMatch = question.match(/(?:about|for|on)\s+([A-ZÀ-Ž][\w'’-]+(?:\s+[A-ZÀ-Ž][\w'’-]+)?)/);
      if (nameMatch) {
        const overview = (await callTool("get_client_overview", { name: nameMatch[1] })) as {
          error?: string;
          client?: { name: string };
        };
        if (overview && !overview.error) {
          return [
            `Here is what is on file (mock engine — set ANTHROPIC_API_KEY for real answers):`,
            "```json",
            JSON.stringify(overview, null, 2),
            "```",
          ].join("\n");
        }
      }
      const [pipeline, missing, coverage] = [
        await callTool("pipeline_summary"),
        await callTool("missing_documents"),
        await callTool("authorization_coverage"),
      ];
      const p = pipeline as { activeClients: number; stages: { stage: string; count: number }[] };
      const m = missing as { client: string; missingRequired: string[] }[];
      const c = (coverage as { totals: { covered: number; clients: number } }).totals;
      return [
        "Practice snapshot (mock engine — set ANTHROPIC_API_KEY for real answers):",
        `- Active clients in your view: ${p.activeClients}`,
        `- Pipeline: ${p.stages.filter((s) => s.count > 0).map((s) => `${s.stage} ${s.count}`).join(" · ") || "empty"}`,
        `- Waiting on documents: ${m.length} return(s)${m.length ? ` (${m.map((x) => x.client).join(", ")})` : ""}`,
        `- CRA authorization coverage: ${c.covered}/${c.clients} clients covered`,
      ].join("\n");
    },
  });
}

const draftSchema = z.object({ clientId: z.string().uuid(), instructions: z.string() });

export type EmailDraft = { subject: string; body: string };

/**
 * Email drafts page. Returns a draft — NOTHING here sends; the send path is
 * a separate messages.send_custom action (ADR-0031).
 */
export async function draftClientEmail(
  ctx: AiToolContext,
  input: z.infer<typeof draftSchema>
): Promise<AiRunResult & { draft: EmailDraft }> {
  const { clientId, instructions } = draftSchema.parse(input);
  const run = await runFeature({
    ctx,
    feature: "email_draft",
    prompt: instructions,
    turns: [
      {
        role: "user",
        content: `Draft an email to the client with id ${clientId}. Instructions from me: ${instructions}`,
      },
    ],
    systemExtra: [
      "You draft emails FROM the accountant TO their client. Plain, warm, large-print-friendly language — much of this firm's clientele is elderly. Short sentences. No jargon.",
      'Respond with exactly this format: first line "Subject: <subject>", then a blank line, then the email body. No commentary before or after.',
      "The body should end with a signature from the staff member's name and the firm name.",
      "Use get_client_overview and missing_documents to ground the content (real missing items only — never invent).",
    ].join("\n"),
    mock: async (mockCtx, callTool) => {
      const overview = (await callTool("get_client_overview", { clientId })) as {
        error?: string;
        client?: { name: string };
        returns?: { type: string; taxYear: number; stage: string; checklist: { requiredMissing: string[] } }[];
      };
      if (overview.error || !overview.client) return `Subject: (draft unavailable)\n\n${overview.error}`;
      const firstName = overview.client.name.split(" ")[0];
      const latest = overview.returns?.[0];
      const missing = latest?.checklist.requiredMissing ?? [];
      const subject = latest
        ? `Your ${latest.taxYear} ${latest.type} return — ${missing.length ? "a few things we still need" : "quick update"}`
        : `Checking in from ${mockCtx.orgName}`;
      const lines = [
        `Subject: ${subject}`,
        "",
        `Hello ${firstName},`,
        "",
      ];
      if (latest && missing.length) {
        lines.push(
          `We are working on your ${latest.taxYear} ${latest.type} return and still need:`,
          ...missing.map((t) => `  • ${t}`),
          "",
          "You can send them through your secure portal link, or drop them off — whatever is easiest."
        );
      } else if (latest) {
        lines.push(
          `Good news — your ${latest.taxYear} ${latest.type} return is moving along (currently: ${latest.stage}). Nothing is needed from you right now.`
        );
      } else {
        lines.push("Just checking in — let us know when you'd like to get started on this year's return.");
      }
      lines.push("", "Warm regards,", mockCtx.user.name, mockCtx.orgName);
      lines.push("", `(Mock draft based on: ${scrubFreeText(instructions)})`);
      return lines.join("\n");
    },
  });
  return { ...run, draft: parseEmailDraft(run.text) };
}

export function parseEmailDraft(text: string): EmailDraft {
  const match = text.match(/^\s*Subject:\s*(.+)\r?\n\r?\n?([\s\S]*)$/);
  if (!match) return { subject: "", body: text.trim() };
  return { subject: match[1].trim(), body: match[2].trim() };
}

/** Meeting prep: a one-page brief for sitting down with a client. */
export async function prepareMeetingBrief(
  ctx: AiToolContext,
  clientId: string
): Promise<AiRunResult> {
  return runFeature({
    ctx,
    feature: "meeting_prep",
    prompt: `Meeting prep for client ${clientId}`,
    turns: [
      {
        role: "user",
        content: `Prepare a meeting brief for the client with id ${clientId}: who they are, where their returns stand, what's outstanding, recent conversations, CRA authorization state, and 3-5 suggested talking points.`,
      },
    ],
    systemExtra:
      "Produce a compact brief with short headed sections: Client, Returns, Outstanding, Recent contact, Talking points. Use get_client_overview (and billing_summary if billing questions may come up).",
    mock: async (mockCtx, callTool) => {
      const overview = (await callTool("get_client_overview", { clientId })) as {
        error?: string;
        client?: {
          name: string;
          type: string;
          assignedAccountant: string | null;
          household: string | null;
          householdMembers: string[];
        };
        notes?: { pinned: boolean; body: string }[];
        recentContacts?: { channel: string; date: string | Date; summary: string }[];
        returns?: {
          type: string;
          taxYear: number;
          stage: string;
          checklist: { requiredMissing: string[]; waived: string[] };
        }[];
        craAuthorization?: { coverage: string; expiringSoon: boolean };
      };
      if (overview.error || !overview.client) return overview.error ?? "Client not found.";
      const c = overview.client;
      const missing = (overview.returns ?? []).flatMap((r) =>
        r.checklist.requiredMissing.map((t) => `${t} (${r.type} ${r.taxYear})`)
      );
      const talking: string[] = [];
      if (missing.length) talking.push(`Collect: ${missing.join(", ")}`);
      if (overview.craAuthorization?.coverage !== "active")
        talking.push("CRA authorization is not active — get a new consent signed.");
      if (overview.craAuthorization?.expiringSoon)
        talking.push("CRA authorization expires soon — renew it.");
      const pinned = (overview.notes ?? []).filter((n) => n.pinned);
      if (pinned.length) talking.push(`Note on file: ${pinned[0].body}`);
      if (talking.length < 3) talking.push("Confirm contact details and preferred channel are current.");
      return [
        `# Meeting brief: ${c.name}`,
        "",
        `**Client** — ${c.type}${c.household ? `, household "${c.household}" (${["themselves", ...c.householdMembers].join(", ")})` : ""}. Accountant: ${c.assignedAccountant ?? "unassigned"}.`,
        "",
        "**Returns**",
        ...(overview.returns ?? []).map(
          (r) => `- ${r.type} ${r.taxYear}: ${r.stage}${r.checklist.requiredMissing.length ? ` — still missing: ${r.checklist.requiredMissing.join(", ")}` : ""}`
        ),
        "",
        "**Recent contact**",
        ...(overview.recentContacts ?? [])
          .slice(0, 5)
          .map((x) => `- ${new Date(x.date).toISOString().slice(0, 10)} (${x.channel}): ${x.summary}`),
        "",
        "**Talking points**",
        ...talking.map((t) => `- ${t}`),
        "",
        "_(Mock brief — set ANTHROPIC_API_KEY for a narrative version.)_",
      ].join("\n");
    },
  });
}

/**
 * Audit-risk / optimization narrative over deterministic findings
 * (ADR-0032). The findings are computed BEFORE the model is involved; the
 * model (or mock) only phrases them.
 */
export async function narrateFindings(
  ctx: AiToolContext,
  feature: "audit_risk" | "optimize",
  findings: { rule: string; severity: string; client?: string; summary: string }[]
): Promise<AiRunResult> {
  const heading = feature === "audit_risk" ? "practice-risk review" : "practice optimization review";
  return runFeature({
    ctx,
    feature,
    prompt: `Narrate ${findings.length} ${heading} finding(s)`,
    turns: [
      {
        role: "user",
        content: `Here are today's ${heading} findings as JSON. Write a short narrative summary for the accountant: group by theme, lead with what matters most, and keep each point to one sentence. Do not add findings of your own or drop any. JSON:\n${JSON.stringify(findings)}`,
      },
    ],
    systemExtra:
      "You are summarizing deterministic rule output. Never invent, re-rank, or discard findings — narrate exactly what is given.",
    mock: async () => {
      if (findings.length === 0)
        return "Nothing needs attention right now — all rules came back clean.";
      const bySeverity = { high: [] as string[], medium: [] as string[], low: [] as string[] };
      for (const f of findings) {
        const line = `${f.client ? `**${f.client}** — ` : ""}${f.summary} _[${f.rule}]_`;
        (bySeverity[f.severity as keyof typeof bySeverity] ?? bySeverity.low).push(line);
      }
      const sections: string[] = [];
      if (bySeverity.high.length)
        sections.push("**Needs attention now**", ...bySeverity.high.map((l) => `- ${l}`), "");
      if (bySeverity.medium.length)
        sections.push("**Worth a look**", ...bySeverity.medium.map((l) => `- ${l}`), "");
      if (bySeverity.low.length)
        sections.push("**Minor**", ...bySeverity.low.map((l) => `- ${l}`), "");
      return sections.join("\n").trim();
    },
  });
}

/** Build the AiToolContext from a StaffContext without importing next/headers here. */
export function aiContextFromStaff(ctx: {
  scope: AiToolContext["scope"];
  orgId: string;
  orgName: string;
  role: AiToolContext["role"];
  orgSettings: AiToolContext["orgSettings"];
  user: AiToolContext["user"];
}): AiToolContext {
  return {
    scope: ctx.scope,
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    role: ctx.role,
    orgSettings: ctx.orgSettings,
    user: ctx.user,
  };
}
