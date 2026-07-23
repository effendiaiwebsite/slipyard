"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import {
  buildStagedRows,
  parseCsv,
  suggestMapping,
  type StagedRow,
} from "@/lib/imports";
import { authorize, can, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * Generic import wizard (M9, ADR-0033). Owner/admin only (import.manage).
 * Preview is an in-memory parse (no DB, no audit); staging/commit/rollback are
 * audited writes. SIN never leaves buildStagedRows as plaintext.
 */

const MAX_CSV_BYTES = 2_000_000;
const MAX_ROWS = 5000;

type Denied = { error: string };

function gate(ctx: Awaited<ReturnType<typeof requireStaff>>): Denied | null {
  if (!can(ctx.actor, "import.manage")) {
    return { error: "You don't have access to the import wizard (owner/admin only)." };
  }
  return null;
}

async function auditedGate(
  ctx: Awaited<ReturnType<typeof requireStaff>>,
  op: string,
  details?: Record<string, unknown>
): Promise<Denied | null> {
  try {
    await authorize(ctx.scope, ctx.actor, "import.manage", undefined, {
      readOnlyOrg: ctx.readOnly,
      details: { op, ...details },
    });
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }
}

export type PreviewResult =
  | Denied
  | {
      ok: true;
      headers: string[];
      delimiter: string;
      rowCount: number;
      sampleRows: string[][];
      suggestedMapping: Record<string, string>;
      warnings: string[];
    };

/** Step 1 → 2: parse the pasted/uploaded CSV, suggest a mapping. No persistence. */
export async function previewImport(csv: string): Promise<PreviewResult> {
  const ctx = await requireStaff();
  const denied = gate(ctx);
  if (denied) return denied;
  if (typeof csv !== "string" || csv.length === 0) return { error: "Paste or upload a CSV first." };
  if (csv.length > MAX_CSV_BYTES) return { error: "That file is too large (2 MB max)." };

  const parsed = parseCsv(csv);
  if (parsed.headers.length === 0) {
    return { error: parsed.warnings[0] ?? "Couldn't read a header row." };
  }
  if (parsed.rows.length > MAX_ROWS) {
    return { error: `That file has ${parsed.rows.length} rows — split it into batches of ${MAX_ROWS} or fewer.` };
  }
  return {
    ok: true,
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    rowCount: parsed.rows.length,
    sampleRows: parsed.rows.slice(0, 8),
    suggestedMapping: suggestMapping(parsed.headers),
    warnings: parsed.warnings,
  };
}

/** A browser-safe projection of a staged row (no ciphertext, SIN masked). */
export type StagedPreviewRow = {
  rowNumber: number;
  action: "create" | "skip";
  displayName: string | null;
  type: string;
  email: string | null;
  hasSin: boolean;
  customFields: Record<string, string>;
  warnings: string[];
};

function toPreview(rows: StagedRow[]): StagedPreviewRow[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    action: r.action,
    displayName: r.mapped.displayName,
    type: r.mapped.type,
    email: r.mapped.email,
    hasSin: !!r.mapped.sinEncrypted,
    customFields: r.mapped.customFields,
    warnings: r.warnings,
  }));
}

export type StageResult =
  | Denied
  | {
      ok: true;
      batchId: string;
      rowCount: number;
      createCount: number;
      skipCount: number;
      warningCount: number;
      preview: StagedPreviewRow[];
    };

const mappingSchema = z.record(z.string(), z.string());

/** Step 2 → 3: build + persist a staged batch from CSV + mapping. */
export async function stageImport(
  csv: string,
  mappingJson: string,
  replaceBatchId?: string
): Promise<StageResult> {
  const ctx = await requireStaff();
  if (typeof csv !== "string" || csv.length === 0 || csv.length > MAX_CSV_BYTES) {
    return { error: "Missing or oversized CSV." };
  }
  let mapping: Record<string, string>;
  try {
    mapping = mappingSchema.parse(JSON.parse(mappingJson));
  } catch {
    return { error: "Invalid column mapping." };
  }

  const parsed = parseCsv(csv);
  if (parsed.headers.length === 0) return { error: "Couldn't read a header row." };
  if (parsed.rows.length > MAX_ROWS) return { error: "Too many rows." };

  const denied = await auditedGate(ctx, "import_stage", { rows: parsed.rows.length });
  if (denied) return denied;

  // Re-staging (mapping changed) discards the prior staged batch first.
  if (replaceBatchId && z.string().uuid().safeParse(replaceBatchId).success) {
    await ctx.scope.deleteStagedImportBatch(replaceBatchId);
  }

  const staged = buildStagedRows(parsed, mapping);
  const batch = await ctx.scope.createStagedImportBatch({
    filename: "Imported CSV",
    sourceColumns: parsed.headers,
    mapping,
    rows: staged.rows,
  });

  return {
    ok: true,
    batchId: batch.id,
    rowCount: staged.rows.length,
    createCount: staged.createCount,
    skipCount: staged.skipCount,
    warningCount: staged.warningCount,
    preview: toPreview(staged.rows),
  };
}

export type CommitResult = Denied | { ok: true; createdCount: number; unresolvedAccountants: number };

/** Step 3 → 4: create the client rows. */
export async function commitImport(batchId: string): Promise<CommitResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(batchId).success) return { error: "Invalid batch." };
  const denied = await auditedGate(ctx, "import_commit", { batchId });
  if (denied) return denied;

  const res = await ctx.scope.commitImportBatch(batchId);
  if (!res.ok) {
    return { error: res.reason === "not_found" ? "Import not found." : "This import was already committed." };
  }
  revalidatePath("/app/clients");
  revalidatePath("/app/settings/import");
  return { ok: true, createdCount: res.createdCount, unresolvedAccountants: res.unresolvedAccountants };
}

export type RollbackResult =
  | Denied
  | { ok: true; removed: number; kept: Array<{ name: string }>; status: "rolled_back" | "partially_rolled_back" };

/** Undo a committed import (delete untouched imported clients). */
export async function rollbackImport(batchId: string): Promise<RollbackResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(batchId).success) return { error: "Invalid batch." };
  const denied = await auditedGate(ctx, "import_rollback", { batchId });
  if (denied) return denied;

  const res = await ctx.scope.rollbackImportBatch(batchId);
  if (!res.ok) {
    return { error: res.reason === "not_found" ? "Import not found." : "This import can't be rolled back." };
  }
  revalidatePath("/app/clients");
  revalidatePath("/app/settings/import");
  return { ok: true, removed: res.removed, kept: res.kept, status: res.status };
}

/** Discard a still-staged batch (nothing was created). */
export async function discardBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(batchId).success) return { ok: false, error: "Invalid batch." };
  const denied = gate(ctx);
  if (denied) return { ok: false, error: denied.error };
  await ctx.scope.deleteStagedImportBatch(batchId);
  return { ok: true };
}

const templateNameSchema = z.string().trim().min(1).max(60);

export async function saveMappingTemplate(
  name: string,
  mappingJson: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireStaff();
  const denied = await auditedGate(ctx, "import_save_template");
  if (denied) return { ok: false, error: denied.error };
  const parsedName = templateNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "Give the mapping a name (1–60 chars)." };
  let mapping: Record<string, string>;
  try {
    mapping = mappingSchema.parse(JSON.parse(mappingJson));
  } catch {
    return { ok: false, error: "Invalid mapping." };
  }
  await ctx.scope.upsertImportMappingTemplate(parsedName.data, mapping);
  revalidatePath("/app/settings/import");
  return { ok: true };
}

export async function deleteMappingTemplate(id: string): Promise<{ ok: boolean }> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(id).success) return { ok: false };
  const denied = gate(ctx);
  if (denied) return { ok: false };
  await ctx.scope.deleteImportMappingTemplate(id);
  revalidatePath("/app/settings/import");
  return { ok: true };
}
