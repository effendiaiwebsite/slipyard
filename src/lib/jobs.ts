import "server-only";
import { PgBoss } from "pg-boss";
import { OrgScope } from "@/db/scoped";
import { applyAutoAdvance } from "@/lib/checklists";
import { deliverQueuedMessage } from "@/lib/client-messaging";
import { scanAndRouteDocument } from "@/lib/documents";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runReminderSweep } from "@/lib/reminders";

/**
 * pg-boss job runner (M5). Started once per Next.js server instance from
 * instrumentation.ts; queue state lives in the `pgboss` schema (owned by
 * crm_app — 0016_m5_rls.sql), so jobs survive restarts and multiple app
 * instances would share one queue.
 *
 * Queues:
 *   document-scan   — ClamAV scan moved out of the upload request (ADR-0021
 *                     revising ADR-0016). Retries transient failures; the
 *                     document row stays 'scan_failed' (never clean) if all
 *                     retries exhaust.
 *   message-send    — transport for pre-created mass-send message rows.
 *                     retryLimit 0: provider sends aren't idempotent, and a
 *                     failed row surfaces in the send log for a human retry.
 *   reminders-sweep — the reminder policy evaluator (src/lib/reminders.ts).
 *                     Production: pg-boss cron every 5 minutes. Dev/test:
 *                     a short setInterval enqueue — the accelerated clock.
 *                     singleton policy: concurrent sweeps could double-send.
 *
 * Payloads carry row ids only — never document bytes, message bodies, or
 * anything SIN-adjacent.
 */

export type DocumentScanJob = { orgId: string; documentId: string; checklistItemId?: string | null };
export type MessageSendJob = { orgId: string; messageId: string };

const QUEUES = {
  documentScan: "document-scan",
  messageSend: "message-send",
  remindersSweep: "reminders-sweep",
} as const;

// Survive dev HMR / repeated register() calls within one process.
const g = globalThis as unknown as {
  __crmBoss?: PgBoss;
  __crmSweepTimer?: ReturnType<typeof setInterval>;
};

function newBoss(): PgBoss {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => logger.error({ err: err.message }, "pg-boss error"));
  return boss;
}

/** The running boss, or null when the runner is off (JOBS_ENABLED=false / not started). */
export function getBoss(): PgBoss | null {
  return g.__crmBoss ?? null;
}

export async function startJobs(): Promise<void> {
  if (!features.jobs) {
    logger.info("JOBS_ENABLED=false — job runner not started");
    return;
  }
  if (g.__crmBoss) return;

  const boss = newBoss();
  await boss.start();
  g.__crmBoss = boss;

  await boss.createQueue(QUEUES.documentScan, { retryLimit: 3, retryDelay: 30 });
  await boss.createQueue(QUEUES.messageSend, { retryLimit: 0 });
  await boss.createQueue(QUEUES.remindersSweep, { policy: "singleton", retryLimit: 0 });

  // batchSize 1 for scans: a scan_failed throw must only retry ITS job.
  await boss.work<DocumentScanJob>(QUEUES.documentScan, { batchSize: 1 }, async ([job]) => {
    await runDocumentScanJob(job.data);
  });
  // Mass sends drain faster in batches; per-job isolation is in the runner
  // (deliverQueuedMessage never throws on provider failure — the row does).
  await boss.work<MessageSendJob>(QUEUES.messageSend, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      try {
        await runMessageSendJob(job.data);
      } catch (e) {
        logger.warn(
          { messageId: job.data.messageId, err: e instanceof Error ? e.message : String(e) },
          "message-send job failed"
        );
      }
    }
  });
  await boss.work(QUEUES.remindersSweep, async () => {
    await runReminderSweep();
  });

  if (env.NODE_ENV === "production") {
    await boss.schedule(QUEUES.remindersSweep, "*/5 * * * *");
  } else {
    // Accelerated clock for dev + e2e: enqueue the sweep on a short
    // interval (singleton queue absorbs pile-ups if a sweep runs long).
    const intervalMs = env.REMINDER_SWEEP_INTERVAL_MS ?? 5000;
    clearInterval(g.__crmSweepTimer);
    g.__crmSweepTimer = setInterval(() => {
      boss
        .send(QUEUES.remindersSweep, {}, { singletonKey: "sweep" })
        .catch((e) => logger.warn({ err: String(e) }, "sweep enqueue failed"));
    }, intervalMs);
    g.__crmSweepTimer.unref?.();
  }

  logger.info(
    { queues: Object.values(QUEUES), sweep: env.NODE_ENV === "production" ? "cron */5" : "interval" },
    "pg-boss job runner started"
  );
}

/**
 * Enqueue a document scan; returns false when the runner isn't up (tests,
 * JOBS_ENABLED=false) so the caller can fall back to a synchronous scan.
 */
export async function enqueueDocumentScan(job: DocumentScanJob): Promise<boolean> {
  const boss = getBoss();
  if (!boss) return false;
  await boss.send(QUEUES.documentScan, job);
  return true;
}

export async function enqueueMessageSend(job: MessageSendJob): Promise<boolean> {
  const boss = getBoss();
  if (!boss) return false;
  await boss.send(QUEUES.messageSend, job);
  return true;
}

/**
 * Scan worker body (exported for tests + the no-runner fallback): scan,
 * route quarantine→vault, then — clean uploads only — satisfy the checklist
 * slot and re-evaluate auto-advance, exactly as the upload routes did
 * synchronously pre-M5.
 */
export async function runDocumentScanJob(data: DocumentScanJob): Promise<void> {
  const scope = new OrgScope(data.orgId, null);
  const doc = await scope.getDocument(data.documentId);
  if (!doc) return; // deleted meanwhile — nothing to do
  if (doc.status !== "pending_scan" && doc.status !== "scan_failed") return; // already settled

  const scanned = await scanAndRouteDocument(scope, doc);

  if (scanned.status === "clean" && data.checklistItemId) {
    const item = await scope.getChecklistItem(data.checklistItemId);
    if (item && item.status === "missing") {
      await scope.updateChecklistItem(item.id, { status: "received", documentId: scanned.id });
      await applyAutoAdvance(scope, item.engagementId);
    }
  }

  if (scanned.status === "scan_failed") {
    // Throw so pg-boss retries (scanner restarts, S3 blips). The row is
    // already 'scan_failed' — safe (never clean) even if retries exhaust.
    throw new Error(`scan failed for document ${scanned.id}`);
  }
}

/** Mass-send worker body: deliver one pre-created queued message row. */
export async function runMessageSendJob(data: MessageSendJob): Promise<void> {
  const scope = new OrgScope(data.orgId, null);
  const message = await scope.getMessage(data.messageId);
  if (!message || message.status !== "queued") return;
  const template = message.templateId ? await scope.getMessageTemplate(message.templateId) : null;
  const label = template?.name ?? message.subject ?? "message";
  await deliverQueuedMessage(scope, message, `Sent "${label}".`);
}
