import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { adminUrl, APP_DB_NAME } from "./db-lib";

/**
 * Database backup (M9, ADR-0034). Runs pg_dump in the compressed custom
 * format (-Fc) to ./backups/, then optionally uploads to S3 under
 * backups/{db}/ (versioned bucket, ca-central-1) — the same region + KMS
 * posture as the document vault. This is the DB half of the retention story;
 * the no-delete document posture (ADR-0016/0027) is the other half.
 *
 * Usage:
 *   pnpm tsx scripts/backup.ts [--dry-run] [--no-upload] [--out DIR]
 *   PG_DUMP=/path/to/pg_dump pnpm tsx scripts/backup.ts   # if not on PATH
 *
 * --dry-run prints the plan (credentials redacted) and checks that pg_dump is
 * reachable, without producing a dump. Production runs this on a schedule
 * (cron / a managed backup) — the script is the portable, reviewable core.
 */

type Args = { dryRun: boolean; upload: boolean; outDir: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, upload: true, outDir: "backups" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-upload") args.upload = false;
    else if (a === "--out") args.outDir = argv[++i] ?? args.outDir;
  }
  return args;
}

function pgDumpBin(): string {
  return process.env.PG_DUMP || "pg_dump";
}

/** ISO-ish timestamp safe for filenames: 2026-07-23T041530Z. */
function stamp(): string {
  return new Date().toISOString().replace(/[:]/g, "").replace(/\.\d+Z$/, "Z");
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

async function uploadToS3(localPath: string, key: string): Promise<void> {
  // Imported lazily so the script runs (dump-only) without AWS configured.
  const { putObject } = await import("@/lib/storage");
  const body = readFileSync(localPath);
  await putObject(key, body, "application/octet-stream");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = adminUrl(APP_DB_NAME);
  const bin = pgDumpBin();
  const s3Bucket = process.env.S3_BUCKET;
  const willUpload = args.upload && !!s3Bucket;

  console.log(`Backup plan:`);
  console.log(`  database : ${APP_DB_NAME}`);
  console.log(`  source   : ${redact(url)}`);
  console.log(`  pg_dump  : ${bin}`);
  console.log(`  format   : custom (-Fc, compressed)`);
  console.log(`  out dir  : ${args.outDir}/`);
  console.log(`  upload   : ${willUpload ? `s3://${s3Bucket}/backups/${APP_DB_NAME}/` : "no (S3 not configured or --no-upload)"}`);

  // Verify pg_dump is reachable.
  const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    const msg =
      `pg_dump was not found (${bin}). Install PostgreSQL client tools or set PG_DUMP ` +
      `to the full path (e.g. "C:/Program Files/PostgreSQL/16/bin/pg_dump.exe").`;
    if (args.dryRun) {
      console.log(`\n[dry-run] ${msg}`);
      console.log("[dry-run] No dump produced.");
      return;
    }
    throw new Error(msg);
  }
  console.log(`  version  : ${(probe.stdout || "").trim()}`);

  if (args.dryRun) {
    console.log("\n[dry-run] pg_dump is reachable; no dump produced.");
    return;
  }

  mkdirSync(args.outDir, { recursive: true });
  const filename = `${APP_DB_NAME}-${stamp()}.dump`;
  const localPath = join(args.outDir, filename);

  console.log(`\nDumping → ${localPath} …`);
  await new Promise<void>((resolve, reject) => {
    // Pass the connection string via env; args carry no secrets.
    const child = spawn(bin, ["-Fc", "--no-owner", "--no-acl", "-f", localPath, url], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`))));
  });

  const bytes = statSync(localPath).size;
  console.log(`Dump complete: ${(bytes / (1024 * 1024)).toFixed(2)} MB`);

  if (willUpload) {
    const key = `backups/${APP_DB_NAME}/${filename}`;
    console.log(`Uploading → s3://${s3Bucket}/${key} …`);
    try {
      await uploadToS3(localPath, key);
      console.log("Uploaded. Removing local copy.");
      unlinkSync(localPath);
    } catch (e) {
      console.error(`Upload failed (${(e as Error).message}). Local dump kept at ${localPath}.`);
      process.exitCode = 1;
    }
  } else {
    console.log(`Local backup kept at ${localPath}.`);
  }
}

main().catch((e) => {
  console.error(`Backup failed: ${(e as Error).message}`);
  process.exit(1);
});
