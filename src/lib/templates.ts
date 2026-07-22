import type { OrgScope } from "@/db/scoped";

/**
 * Message template engine (M5). Templates are plain text with {variable}
 * placeholders; rendering is a literal substitution — no expressions, no
 * HTML, nothing evaluated. Unknown placeholders are left in place and
 * reported so previews can flag typos instead of silently sending them.
 *
 * SIN, DOB, and document contents are never template variables.
 */

export const TEMPLATE_VARIABLES = [
  { name: "client_name", description: "The client's display name" },
  { name: "first_name", description: "First word of the client's name" },
  { name: "firm_name", description: "Your firm's name" },
  { name: "tax_year", description: "Tax year of the engagement (blank if none)" },
  { name: "missing_docs", description: "Comma-separated list of still-missing checklist items" },
  { name: "accountant_name", description: "Assigned accountant (blank if unassigned)" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["name"];

const KNOWN_VARIABLES = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.name));

const PLACEHOLDER = /\{([a-z_]+)\}/g;

export type RenderResult = {
  text: string;
  /** Placeholders that had no value (unknown name or empty variable). */
  unresolved: string[];
};

/** Substitute {placeholders}; unknown/empty ones stay literal and are reported. */
export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string>>): RenderResult {
  const unresolved: string[] = [];
  const text = body.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name as TemplateVariable];
    if (value) return value;
    unresolved.push(name);
    return match;
  });
  return { text, unresolved: [...new Set(unresolved)] };
}

/** Static validation for the template editor: every placeholder must be a known variable. */
export function findUnknownVariables(body: string): string[] {
  const unknown = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) {
    if (!KNOWN_VARIABLES.has(m[1])) unknown.add(m[1]);
  }
  return [...unknown];
}

/**
 * Variables for one client (+ optionally one engagement). `missingDocs`
 * comes from the caller (checklist queries differ per flow); empty list
 * renders as an empty string, which previews flag via `unresolved`.
 */
export function buildTemplateVars(input: {
  clientName: string;
  firmName: string;
  taxYear?: number | null;
  missingDocs?: string[];
  accountantName?: string | null;
}): Partial<Record<TemplateVariable, string>> {
  return {
    client_name: input.clientName,
    first_name: input.clientName.split(/\s+/)[0] ?? "",
    firm_name: input.firmName,
    tax_year: input.taxYear ? String(input.taxYear) : "",
    missing_docs: (input.missingDocs ?? []).join(", "),
    accountant_name: input.accountantName ?? "",
  };
}

/**
 * The templates every org starts with (org bootstrap + seed). Names are
 * stable identifiers for the reminder default lookup — renaming in the UI
 * is fine (reminders then use the org's configured template_id or fall back
 * by channel), but keep these in sync with defaultTemplateFor().
 */
export const DEFAULT_MESSAGE_TEMPLATES: ReadonlyArray<{
  name: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
}> = [
  {
    name: "Missing documents reminder (text)",
    channel: "sms",
    subject: null,
    body:
      "Hi {first_name}, it's {firm_name}. For your {tax_year} tax return we still need: {missing_docs}. " +
      "You can drop them off at the office or send them through your secure portal link. Reply STOP to opt out of texts.",
  },
  {
    name: "Missing documents reminder (email)",
    channel: "email",
    subject: "Documents still needed for your {tax_year} return",
    body:
      "Hello {client_name},\n\n" +
      "We're working on your {tax_year} tax return and are still missing the following:\n\n" +
      "{missing_docs}\n\n" +
      "You can drop them off at the office, mail them, or send them through your secure portal link if you have one. " +
      "If you've already sent these, thank you — please disregard this note.\n\n" +
      "{firm_name}",
  },
  {
    name: "Tax season kickoff",
    channel: "email",
    subject: "It's tax time — let's get your {tax_year} return started",
    body:
      "Hello {client_name},\n\n" +
      "Tax season is here. When your slips arrive, drop them off or send them through your secure portal link and we'll get started on your return.\n\n" +
      "Talk soon,\n{firm_name}",
  },
];

/**
 * The reminder engine's fallback when the org hasn't picked a template (or
 * the picked one was deleted/archived): the org's unarchived template whose
 * name matches the seeded default for the channel.
 */
export async function defaultTemplateFor(scope: OrgScope, channel: "email" | "sms") {
  const name =
    channel === "sms" ? "Missing documents reminder (text)" : "Missing documents reminder (email)";
  const templates = await scope.listMessageTemplates();
  return templates.find((t) => !t.archivedAt && t.name === name && t.channel === channel) ?? null;
}
