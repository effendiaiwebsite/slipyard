import "server-only";
import { OrgScope, listOrgsForReminderSweep } from "@/db/scoped";
import { reminderSettings, type ReminderSettings } from "@/db/schema";
import { resolveChannel, sendClientMessage } from "@/lib/client-messaging";
import { logger } from "@/lib/logger";
import { buildTemplateVars, defaultTemplateFor, renderTemplate } from "@/lib/templates";

/**
 * Reminder policies (M5): "an engagement has sat in an awaiting_docs-CATEGORY
 * stage for N days with required checklist items still missing → nudge the
 * client about exactly those items."
 *
 * Iron rules, same posture as auto-advance (ADR-0015/0017):
 *  - keyed on stage.category ONLY — firms rename stage keys/labels freely;
 *  - degrade to no-ops, never guess: no usable template, no missing required
 *    items, or no usable channel ⇒ nothing happens (no message row spam —
 *    the sweep re-evaluates constantly, so skips stay silent);
 *  - never nudge the same engagement more often than cadence_days (the
 *    cadence guard reads the send log, so it survives restarts).
 *
 * The sweep itself is scheduled by the job runner (src/lib/jobs.ts):
 * a pg-boss cron in production, a short interval in dev/test — the
 * "accelerated clock" the milestone's e2e proves a reminder against.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SweepResult = { orgsChecked: number; sent: number };

/** All orgs, one pass. System path — no user, no request. */
export async function runReminderSweep(): Promise<SweepResult> {
  const orgs = await listOrgsForReminderSweep();
  let orgsChecked = 0;
  let sent = 0;
  for (const org of orgs) {
    const settings = reminderSettings(org.settings);
    if (!settings.enabled) continue;
    orgsChecked++;
    try {
      sent += await sweepOrgReminders(new OrgScope(org.id, null), org.name, settings);
    } catch (e) {
      // One org's failure must never starve the others.
      logger.warn(
        { orgId: org.id, err: e instanceof Error ? e.message : String(e) },
        "reminder sweep failed for org"
      );
    }
  }
  if (sent > 0) logger.info({ orgsChecked, sent }, "reminder sweep sent nudges");
  return { orgsChecked, sent };
}

/** One org's sweep. Exported for tests (and future per-org manual runs). */
export async function sweepOrgReminders(
  scope: OrgScope,
  firmName: string,
  settings: ReminderSettings
): Promise<number> {
  const candidates = await scope.listEngagementsByStageCategory("awaiting_docs");
  if (candidates.length === 0) return 0;

  // Required-only: optional items don't hold up the return (mirrors
  // auto-advance), so they're not worth a nudge on their own.
  const missingByEngagement = new Map<string, string[]>();
  for (const item of await scope.listMissingChecklistItems()) {
    if (!item.required) continue;
    const list = missingByEngagement.get(item.engagementId) ?? [];
    list.push(item.title);
    missingByEngagement.set(item.engagementId, list);
  }

  const now = Date.now();
  let sent = 0;

  for (const row of candidates) {
    if (row.client.status !== "active") continue;

    const missing = missingByEngagement.get(row.engagement.id);
    if (!missing || missing.length === 0) continue;

    // When did it enter the CURRENT stage? statusTimestamps is keyed by the
    // stage's own (immutable) key; fall back to updatedAt for old rows.
    const enteredIso = row.engagement.statusTimestamps[row.stage.key];
    const enteredAt = enteredIso ? Date.parse(enteredIso) : row.engagement.updatedAt.getTime();
    if (now - enteredAt < settings.awaiting_docs_days * DAY_MS) continue;

    const lastReminder = await scope.latestReminderAt(row.engagement.id);
    if (lastReminder && now - lastReminder.getTime() < settings.cadence_days * DAY_MS) continue;

    const resolution = resolveChannel(row.client, settings.channel);
    if (!resolution.ok) continue;

    // The configured template applies when its channel matches how this
    // client is reachable; otherwise use the org's default for the channel.
    const configured = settings.template_id
      ? await scope.getMessageTemplate(settings.template_id)
      : null;
    const template =
      configured && !configured.archivedAt && configured.channel === resolution.channel
        ? configured
        : await defaultTemplateFor(scope, resolution.channel);
    if (!template) continue;

    const vars = buildTemplateVars({
      clientName: row.client.displayName,
      firmName,
      taxYear: row.engagement.taxYear,
      missingDocs: missing,
      accountantName: row.accountantName,
    });
    const body = renderTemplate(template.body, vars).text;
    const subject = template.subject ? renderTemplate(template.subject, vars).text : null;

    const message = await sendClientMessage(scope, {
      client: row.client,
      engagementId: row.engagement.id,
      templateId: template.id,
      kind: "reminder",
      requestedChannel: resolution.channel,
      subject,
      body,
      contactSummary: `Automatic reminder sent: still waiting on ${missing.length} item${missing.length === 1 ? "" : "s"} for the ${row.engagement.taxYear} ${row.engagement.type.toUpperCase()} return.`,
    });

    if (message.status === "sent") {
      sent++;
      await scope.writeAudit({
        actorType: "system",
        action: "messages.reminder_sent",
        resourceType: "engagement",
        resourceId: row.engagement.id,
        details: {
          clientId: row.client.id,
          messageId: message.id,
          channel: message.channel,
          missingCount: missing.length,
        },
      });
    }
  }
  return sent;
}
