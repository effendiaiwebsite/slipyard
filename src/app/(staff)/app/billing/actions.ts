"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingSettings } from "@/db/schema";
import { requireStaff, type StaffContext } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError, type Action } from "@/lib/permissions";

/**
 * Time & billing mutations (M7, ADR-0030). requireStaff → zod → authorize()
 * (time.record / invoices.manage; accountants on assigned clients only) →
 * OrgScope. Money math lives in src/lib/timebilling.ts.
 */

export type BillingActionResult = { error?: string; ok?: boolean; invoiceId?: string } | null;

const uuid = z.string().uuid();

async function authorizeOnClient(
  ctx: StaffContext,
  action: Action,
  clientId: string,
  details: Record<string, unknown>
): Promise<string | null> {
  const client = await ctx.scope.getClient(clientId);
  if (!client) return "Client not found";
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      action,
      {
        orgId: client.orgId,
        type: "client",
        id: client.id,
        assignedTo: client.assignedAccountantId,
      },
      { readOnlyOrg: ctx.readOnly, orgSettings: ctx.orgSettings, details }
    );
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

function revalidateBillingViews(clientId?: string) {
  revalidatePath("/app/billing");
  revalidatePath("/app/reports");
  if (clientId) revalidatePath(`/app/clients/${clientId}`);
}

const timeEntrySchema = z.object({
  clientId: z.string().uuid(),
  engagementId: z.string().uuid().optional().or(z.literal("")),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.coerce.number().min(0.05).max(24),
  description: z.string().trim().min(2).max(300),
  /** Dollars per hour as typed; stored as cents. */
  rate: z.coerce.number().min(0).max(10000),
});

/** Record time against a client (optionally an engagement). */
export async function recordTimeEntry(
  _prev: BillingActionResult,
  formData: FormData
): Promise<BillingActionResult> {
  const ctx = await requireStaff();
  const parsed = timeEntrySchema.safeParse({
    clientId: formData.get("clientId"),
    engagementId: formData.get("engagementId") ?? "",
    workDate: formData.get("workDate"),
    hours: formData.get("hours"),
    description: formData.get("description"),
    rate: formData.get("rate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const denied = await authorizeOnClient(ctx, "time.record", parsed.data.clientId, {
    op: "record",
    hours: parsed.data.hours,
  });
  if (denied) return { error: denied };

  let engagementId: string | null = parsed.data.engagementId || null;
  if (engagementId) {
    const eng = await ctx.scope.getEngagement(engagementId);
    if (!eng || eng.clientId !== parsed.data.clientId) engagementId = null;
  }

  await ctx.scope.createTimeEntry({
    clientId: parsed.data.clientId,
    engagementId,
    userId: ctx.user.id,
    workDate: parsed.data.workDate,
    minutes: Math.round(parsed.data.hours * 60),
    description: parsed.data.description,
    rateCents: Math.round(parsed.data.rate * 100),
    createdBy: ctx.user.id,
  });
  revalidateBillingViews(parsed.data.clientId);
  return { ok: true };
}

/** Delete an UNBILLED entry (typo). Invoiced entries are locked. */
export async function deleteTimeEntry(entryId: string): Promise<BillingActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(entryId).success) return { error: "Invalid entry" };
  const entry = await ctx.scope.getTimeEntry(entryId);
  if (!entry) return { error: "Time entry not found" };
  if (entry.invoiceId) return { error: "This entry is on an invoice — void the invoice first." };

  const denied = await authorizeOnClient(ctx, "time.record", entry.clientId, {
    op: "delete",
    entryId,
  });
  if (denied) return { error: denied };

  await ctx.scope.deleteTimeEntry(entryId);
  revalidateBillingViews(entry.clientId);
  return { ok: true };
}

/**
 * Invoice ALL of a client's unbilled time (basic model — cherry-picking
 * entries can come later if Joey asks). Uses the org's billing defaults for
 * tax; issue date today, due in 30 days.
 */
export async function createInvoiceForClient(clientId: string): Promise<BillingActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(clientId).success) return { error: "Invalid client" };

  const denied = await authorizeOnClient(ctx, "invoices.manage", clientId, { op: "create" });
  if (denied) return { error: denied };

  const unbilled = await ctx.scope.listTimeEntries({ clientId, unbilledOnly: true });
  if (unbilled.length === 0) return { error: "No unbilled time for this client." };

  const defaults = billingSettings(ctx.orgSettings);
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const invoice = await ctx.scope.createInvoiceWithEntries({
    clientId,
    entryIds: unbilled.map((r) => r.entry.id),
    issueDate: iso(today),
    dueDate: iso(due),
    taxLabel: defaults.tax_label,
    taxRateBps: defaults.tax_rate_bps,
    createdBy: ctx.user.id,
  });
  if (!invoice) return { error: "No unbilled time for this client." };

  revalidateBillingViews(clientId);
  return { ok: true, invoiceId: invoice.id };
}

const statusSchema = z.enum(["sent", "paid", "void"]);

/** draft→sent→paid, or void anytime before paid. Voiding frees the entries. */
export async function setInvoiceStatusAction(
  invoiceId: string,
  status: "sent" | "paid" | "void"
): Promise<BillingActionResult> {
  const ctx = await requireStaff();
  if (!uuid.safeParse(invoiceId).success || !statusSchema.safeParse(status).success) {
    return { error: "Invalid invoice" };
  }
  const invoice = await ctx.scope.getInvoice(invoiceId);
  if (!invoice) return { error: "Invoice not found" };

  const allowed: Record<typeof status, string[]> = {
    sent: ["draft"],
    paid: ["sent"],
    void: ["draft", "sent"],
  };
  if (!allowed[status].includes(invoice.status)) {
    return { error: `A ${invoice.status} invoice can't become ${status}.` };
  }

  const denied = await authorizeOnClient(ctx, "invoices.manage", invoice.clientId, {
    op: "status",
    invoiceId,
    to: status,
  });
  if (denied) return { error: denied };

  await ctx.scope.setInvoiceStatus(invoiceId, status);
  revalidateBillingViews(invoice.clientId);
  revalidatePath(`/app/billing/invoices/${invoiceId}`);
  return { ok: true };
}
