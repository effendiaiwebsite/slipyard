import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, features } from "@/lib/env";

/**
 * S3 document storage (M3). Key layout is the tenancy boundary in S3:
 *
 *   org/{orgId}/quarantine/{documentId}/{filename}   — uploaded, not yet scanned
 *   org/{orgId}/vault/{documentId}/{filename}        — scanned clean
 *   org/{orgId}/signed/...                           — M6 executed PDFs
 *
 * Objects move quarantine → vault only via promoteToVault() after a clean
 * ClamAV verdict. Infected/scan_failed objects stay under quarantine/ and
 * are never handed out via presigned GET. Reads are 5-minute presigned GETs
 * (bytes don't stream through the app); presigned URLs are never logged.
 * Dev bucket uses S3 default encryption; production adds KMS via KMS_KEY_ID.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB (matches clamd StreamMaxLength)

/** Content types the vault accepts (tax slips, statements, scans, photos). */
export const ALLOWED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

let client: S3Client | null = null;

function s3(): S3Client {
  if (!features.s3) {
    throw new Error("S3 is not configured (S3_BUCKET / AWS keys — see .env.example).");
  }
  client ??= new S3Client({ region: env.AWS_REGION });
  return client;
}

function bucket(): string {
  if (!env.S3_BUCKET) throw new Error("S3 is not configured (S3_BUCKET — see .env.example).");
  return env.S3_BUCKET;
}

/**
 * Display/key-safe filename: strips any path, replaces everything outside a
 * conservative allowlist, and caps length. Never trusted as a path.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, ""); // no dot-files / traversal remnants
  return (cleaned || "document").slice(0, 140);
}

export function quarantineKey(orgId: string, documentId: string, filename: string): string {
  return `org/${orgId}/quarantine/${documentId}/${filename}`;
}

export function vaultKey(orgId: string, documentId: string, filename: string): string {
  return `org/${orgId}/vault/${documentId}/${filename}`;
}

/** Executed e-signature PDFs (M6) — immutable, generated internally. */
export function signedKey(orgId: string, documentId: string, filename: string): string {
  return `org/${orgId}/signed/${documentId}/${filename}`;
}

/** KMS in production when configured; dev bucket relies on default encryption. */
function encryptionParams() {
  return env.KMS_KEY_ID
    ? ({ ServerSideEncryption: "aws:kms", SSEKMSKeyId: env.KMS_KEY_ID } as const)
    : {};
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ...encryptionParams(),
    })
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Copy quarantine → vault, then remove the quarantined original. */
export async function promoteToVault(fromKey: string, toKey: string): Promise<void> {
  const b = bucket();
  await s3().send(
    new CopyObjectCommand({
      Bucket: b,
      // CopySource is URI-encoded per SDK requirements (keys contain '/').
      CopySource: encodeURIComponent(`${b}/${fromKey}`),
      Key: toKey,
      ...encryptionParams(),
    })
  );
  await s3().send(new DeleteObjectCommand({ Bucket: b, Key: fromKey }));
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * 5-minute presigned GET with a download disposition. The only sanctioned
 * read path for vault objects — and callers must gate it on status='clean'.
 */
export async function presignDownloadUrl(
  key: string,
  filename: string,
  contentType: string
): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn: 300 }
  );
}

/**
 * 5-minute presigned GET with an INLINE disposition — for viewing a source
 * PDF in the browser (the e-sign placement editor + the signing surface),
 * not downloading it. Same status='clean' gating applies at the call site.
 */
export async function presignInlineUrl(
  key: string,
  filename: string,
  contentType: string
): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `inline; filename="${sanitizeFilename(filename)}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn: 300 }
  );
}
