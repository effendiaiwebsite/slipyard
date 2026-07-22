import type { OrgScope } from "@/db/scoped";
import type { schema } from "@/db";
import { ClamAvUnavailableError, scanBuffer } from "@/lib/clamav";
import { logger } from "@/lib/logger";
import { getObjectBuffer, promoteToVault, vaultKey } from "@/lib/storage";

type DocumentRow = typeof schema.document.$inferSelect;

/**
 * The quarantine→verdict step of the upload pipeline (M3, ADR-0016): scan
 * bytes with ClamAV and route the S3 object accordingly.
 *
 *   clean       → promote to org/{orgId}/vault/, row status 'clean'
 *   infected    → object STAYS in quarantine, row status 'infected' (never
 *                 downloadable; deletable via documents.manage)
 *   scanner down/errored → row status 'scan_failed' (retryable; never
 *                 treated as clean)
 *
 * `bytes` is passed by the upload route (still in memory); rescans fetch
 * from S3. Every outcome writes a system audit entry.
 */
export async function scanAndRouteDocument(
  scope: OrgScope,
  doc: DocumentRow,
  bytes?: Buffer
): Promise<DocumentRow> {
  let updated: DocumentRow | null;
  try {
    const data = bytes ?? (await getObjectBuffer(doc.s3Key));
    const result = await scanBuffer(data);

    if (result.verdict === "clean") {
      const destKey = vaultKey(doc.orgId, doc.id, doc.filename);
      await promoteToVault(doc.s3Key, destKey);
      updated = await scope.updateDocument(doc.id, {
        status: "clean",
        s3Key: destKey,
        scanResult: null,
        scannedAt: new Date(),
      });
    } else {
      updated = await scope.updateDocument(doc.id, {
        status: "infected",
        scanResult: result.signature,
        scannedAt: new Date(),
      });
    }
  } catch (e) {
    // Scanner unavailable or S3 hiccup — fail safe, allow retry.
    const message = e instanceof ClamAvUnavailableError ? e.message : "scan pipeline error";
    logger.warn({ documentId: doc.id, err: e instanceof Error ? e.message : String(e) }, "document scan failed");
    updated = await scope.updateDocument(doc.id, {
      status: "scan_failed",
      scanResult: message.slice(0, 300),
      scannedAt: new Date(),
    });
  }

  const final = updated ?? doc;
  await scope.writeAudit({
    actorType: "system",
    action: "documents.scan",
    resourceType: "document",
    resourceId: doc.id,
    details: { verdict: final.status, signature: final.scanResult ?? undefined },
  });
  return final;
}
