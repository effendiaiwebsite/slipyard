import "dotenv/config";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { adminUrl, APP_DB_NAME, withClient } from "./db-lib";

/**
 * S3 lifecycle for deleted orgs (M9, ADR-0034). Deleting a firm cascades its
 * Postgres rows, but the S3 objects under org/{orgId}/ (vault, quarantine,
 * signed) are outside the database and linger. This sweep lists the org
 * prefixes in the bucket, diffs them against the orgs still in the DB, and
 * removes objects under any prefix whose org no longer exists.
 *
 * SAFE BY DEFAULT: dry-run unless --apply is passed. It only ever touches
 * org/{id}/ prefixes whose id is NOT a current org — never a live tenant's
 * data.
 *
 *   pnpm tsx scripts/cleanup-orphaned-s3.ts            # report only
 *   pnpm tsx scripts/cleanup-orphaned-s3.ts --apply    # actually delete
 */

const apply = process.argv.includes("--apply");

async function listOrgPrefixes(s3: S3Client, bucket: string): Promise<string[]> {
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "org/",
        Delimiter: "/",
        ContinuationToken: token,
      })
    );
    for (const cp of res.CommonPrefixes ?? []) {
      // "org/<uuid>/" → "<uuid>"
      const m = cp.Prefix?.match(/^org\/([^/]+)\//);
      if (m) prefixes.push(m[1]);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return prefixes;
}

async function deletePrefix(s3: S3Client, bucket: string, prefix: string): Promise<number> {
  let removed = 0;
  let token: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (keys.length > 0) {
      // DeleteObjects caps at 1000 keys per call; ListObjectsV2 already pages at 1000.
      await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } })
      );
      removed += keys.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

async function main() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.log("S3_BUCKET is not configured — nothing to sweep.");
    return;
  }
  const region = process.env.AWS_REGION || "ca-central-1";
  const s3 = new S3Client({ region });

  // Current orgs (admin connection — bypasses RLS legitimately, like migrate/seed).
  const liveOrgIds = await withClient(adminUrl(APP_DB_NAME), async (c) => {
    const r = await c.query<{ id: string }>("select id from org");
    return new Set(r.rows.map((row) => row.id));
  });

  const bucketOrgIds = await listOrgPrefixes(s3, bucket);
  const orphaned = bucketOrgIds.filter((id) => !liveOrgIds.has(id));

  console.log(`Bucket        : ${bucket} (${region})`);
  console.log(`Live orgs     : ${liveOrgIds.size}`);
  console.log(`Org prefixes  : ${bucketOrgIds.length}`);
  console.log(`Orphaned      : ${orphaned.length}`);
  if (orphaned.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }
  for (const id of orphaned) console.log(`  - org/${id}/`);

  if (!apply) {
    console.log("\n[dry-run] Re-run with --apply to delete the objects above.");
    return;
  }

  let total = 0;
  for (const id of orphaned) {
    const n = await deletePrefix(s3, bucket, `org/${id}/`);
    console.log(`Deleted ${n} object(s) under org/${id}/`);
    total += n;
  }
  console.log(`\nDone. Removed ${total} object(s) across ${orphaned.length} orphaned org prefix(es).`);
}

main().catch((e) => {
  console.error(`Cleanup failed: ${(e as Error).message}`);
  process.exit(1);
});
