"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  compareAfr,
  parseAfrCsv,
  type AfrComparison,
} from "@/lib/afr";
import { applyAutoAdvance } from "@/lib/checklists";
import { requireStaff } from "@/lib/context";
import { authorize, can, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";

/**
 * AFR reconciliation (M7, ADR-0029). The compare itself is a READ — it
 * parses the pasted CSV and diffs it against the engagement's checklist +
 * the client's documents, writing nothing (audited as a client-data view).
 * The only mutation is the optional "start tracking this slip" follow-up,
 * which adds a checklist item under the usual documents.manage rules.
 */

export type AfrCompareResult = {
  error?: string;
  ok?: boolean;
  warnings?: string[];
  comparison?: AfrComparison;
  engagementId?: string;
  clientName?: string;
  taxYear?: number;
};

const compareSchema = z.object({
  clientId: z.string().uuid(),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  csv: z.string().min(1, "Paste the slip CSV first").max(200_000),
});

export async function runAfrCompare(
  _prev: AfrCompareResult | null,
  formData: FormData
): Promise<AfrCompareResult> {
  const ctx = await requireStaff();
  const parsed = compareSchema.safeParse({
    clientId: formData.get("clientId"),
    taxYear: formData.get("taxYear"),
    csv: formData.get("csv"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { clientId, taxYear, csv } = parsed.data;

  const client = await ctx.scope.getClient(clientId);
  if (!client) return { error: "Client not found" };
  const resource = {
    orgId: client.orgId,
    type: "client",
    id: client.id,
    assignedTo: client.assignedAccountantId,
  };
  if (!can(ctx.actor, "clients.view", resource, ctx.orgSettings)) {
    return { error: "Client not found" };
  }

  const engagements = await ctx.scope.listEngagementsForClients([clientId]);
  const engagement = engagements.find((e) => e.engagement.taxYear === taxYear);
  if (!engagement) {
    return {
      error: `${client.displayName} has no ${taxYear} engagement — create one on the client page first.`,
    };
  }

  const [items, documents] = await Promise.all([
    ctx.scope.listChecklistItems(engagement.engagement.id),
    ctx.scope.listDocumentsByClient(clientId),
  ]);

  const parsedCsv = parseAfrCsv(csv);
  if (parsedCsv.slips.length === 0) {
    return { error: parsedCsv.warnings[0] ?? "No slips found in the pasted CSV." };
  }

  const comparison = compareAfr(
    parsedCsv.slips,
    items.map((i) => ({ id: i.id, title: i.title, status: i.status, required: i.required })),
    documents
      .filter(({ document: d }) => d.status !== "infected")
      .map(({ document: d }) => ({ id: d.id, filename: d.filename }))
  );

  // The compare reads client data — audit it like other client-data views.
  await authorize(
    ctx.scope,
    ctx.actor,
    "documents.view",
    resource,
    { orgSettings: ctx.orgSettings, details: { op: "afr_compare", taxYear, slips: parsedCsv.slips.length } }
  );

  return {
    ok: true,
    warnings: parsedCsv.warnings,
    comparison,
    engagementId: engagement.engagement.id,
    clientName: client.displayName,
    taxYear,
  };
}

/** "Start tracking" an untracked CRA slip: add a required checklist item. */
export async function trackSlipAsChecklistItem(
  engagementId: string,
  slipType: string,
  issuer: string
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(engagementId).success) return { error: "Invalid engagement" };
  const title = `${slipType} slip${issuer ? ` — ${issuer}` : ""}`.slice(0, 200);
  if (title.length < 3) return { error: "Invalid slip" };

  const engagement = await ctx.scope.getEngagement(engagementId);
  if (!engagement) return { error: "Engagement not found" };
  const client = await ctx.scope.getClient(engagement.clientId);

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "documents.manage",
      {
        orgId: engagement.orgId,
        type: "engagement",
        id: engagement.id,
        assignedTo: engagement.assignedToId ?? client?.assignedAccountantId,
      },
      {
        readOnlyOrg: ctx.readOnly,
        orgSettings: ctx.orgSettings,
        details: { op: "afr_track_slip", title },
      }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }

  await ctx.scope.addChecklistItem(engagementId, title, true);
  await applyAutoAdvance(ctx.scope, engagementId);
  revalidatePath(`/app/clients/${engagement.clientId}`);
  revalidatePath("/app/tax");
  return { ok: true };
}
