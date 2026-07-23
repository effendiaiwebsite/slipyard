import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUser } from "./auth";
import { org } from "./tenancy";

/**
 * AI interaction log (M8). Tenant table — org_id + FORCEd RLS
 * (drizzle/0024_m8_rls.sql).
 *
 * One row per AiService run (ADR-0031): who asked, which feature, the prompt,
 * the full response text, and which read tools the run touched (names + row
 * counts only — never the tool payloads, which carry client data). The log is
 * the accountability surface for the iron rule "AI drafts only": every AI
 * output in the product traces back to a row here, and the absence of any
 * write tool means the log is also the complete story of what AI did.
 *
 * PROMPTS ARE STAFF-TYPED FREE TEXT — they may name clients, so this table is
 * as sensitive as client_note. SIN/DOB never appear (the tool layer cannot
 * emit them, and the UI never asks for them).
 */

export const aiFeature = pgEnum("ai_feature", [
  "assistant", // knowledge assistant chat
  "email_draft", // email drafts page
  "meeting_prep", // meeting prep briefs
  "audit_risk", // audit-risk narrative (rules per ADR-0032)
  "optimize", // optimization advisor narrative
]);

export type AiFeatureName = (typeof aiFeature.enumValues)[number];

/** Tool usage summary stored per run — names and result sizes only. */
export type AiToolUse = {
  tool: string;
  /** Rows/items in the tool result — a size, never the data. */
  resultCount: number;
};

export const aiInteraction = pgTable(
  "ai_interaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => staffUser.id),
    feature: aiFeature("feature").notNull(),
    /** The staff member's input (question / draft instructions). */
    prompt: text("prompt").notNull(),
    /** The full text the service returned (draft/answer/narrative). */
    response: text("response").notNull(),
    toolsUsed: jsonb("tools_used").$type<AiToolUse[]>().notNull().default([]),
    /** 'mock' when no API key is configured (ADR-0031). */
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_interaction_org_created_idx").on(t.orgId, t.createdAt),
    index("ai_interaction_org_user_idx").on(t.orgId, t.userId),
  ]
);
