import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { billingSettings } from "@/db/schema";
import { ENGAGEMENT_TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import {
  entryAmountCents,
  formatCents,
  formatInvoiceNumber,
  formatMinutes,
  INVOICE_STATUS_LABELS,
} from "@/lib/timebilling";
import { CreateInvoiceButton, DeleteEntryButton, RecordTimeForm } from "./billing-forms";

export const metadata = { title: "Time & billing" };

const INVOICE_BADGE = {
  draft: "default",
  sent: "accent",
  paid: "success",
  void: "danger",
} as const;

/**
 * Time & billing (M7, ADR-0030): record time, watch unbilled WIP per client,
 * turn a client's WIP into an invoice, track invoice status. Money math in
 * src/lib/timebilling.ts; the invoice PDF generates on demand.
 */
export default async function BillingPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const scopeOpts = assignedOnly ? { assignedToId: assignedOnly } : undefined;

  const [clients, entries, invoices] = await Promise.all([
    ctx.scope.listClientsWithMeta({ status: "active", ...(scopeOpts ?? {}) }),
    ctx.scope.listTimeEntries({ ...(scopeOpts ?? {}), limit: 100 }),
    ctx.scope.listInvoices(scopeOpts),
  ]);

  const defaults = billingSettings(ctx.orgSettings);

  // WIP rollup per client from the unbilled entries in view.
  const unbilled = entries.filter((r) => !r.entry.invoiceId);
  const wipByClient = new Map<string, { name: string; minutes: number; amountCents: number; count: number }>();
  for (const { entry, clientName } of unbilled) {
    const cur = wipByClient.get(entry.clientId) ?? {
      name: clientName,
      minutes: 0,
      amountCents: 0,
      count: 0,
    };
    cur.minutes += entry.minutes;
    cur.amountCents += entryAmountCents(entry);
    cur.count += 1;
    wipByClient.set(entry.clientId, cur);
  }
  const wipRows = [...wipByClient.entries()].sort((a, b) => b[1].amountCents - a[1].amountCents);
  const wipTotal = wipRows.reduce((sum, [, v]) => sum + v.amountCents, 0);

  const clientById = new Map(clients.map((c) => [c.client.id, c.client]));
  const canManageFor = (clientId: string) => {
    const client = clientById.get(clientId);
    if (!client || ctx.readOnly) return false;
    return can(
      ctx.actor,
      "invoices.manage",
      { orgId: ctx.orgId, type: "client", id: clientId, assignedTo: client.assignedAccountantId },
      ctx.orgSettings
    );
  };
  const canRecord = !ctx.readOnly && ctx.role !== "clerk";

  const engagementOptions = (
    await ctx.scope.listEngagementsForClients(clients.map((c) => c.client.id))
  ).map((e) => ({
    id: e.engagement.id,
    clientId: e.engagement.clientId,
    label: `${ENGAGEMENT_TYPE_LABELS[e.engagement.type]} ${e.engagement.taxYear}`,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Time &amp; billing</h1>
        <p className="text-sm text-slate-500 mt-1">
          Record work, watch unbilled totals{assignedOnly ? " for your clients" : ""}, and turn
          them into invoices.
        </p>
      </div>

      {canRecord && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Record time</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordTimeForm
              clients={clients.map((c) => ({ id: c.client.id, name: c.client.displayName }))}
              engagements={engagementOptions}
              defaultRate={Math.round(defaults.hourly_rate_cents / 100)}
              defaultDate={new Date().toISOString().slice(0, 10)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Unbilled work — {formatCents(wipTotal)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wipRows.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing unbilled. Record time above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Entries</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {wipRows.map(([clientId, wip]) => (
                    <tr
                      key={clientId}
                      data-testid="wip-row"
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          href={`/app/clients/${clientId}`}
                          className="text-indigo-700 hover:underline underline-offset-2"
                        >
                          {wip.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{wip.count}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatMinutes(wip.minutes)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCents(wip.amountCents)}</td>
                      <td className="py-2 pr-3">
                        {canManageFor(clientId) && <CreateInvoiceButton clientId={clientId} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-400">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                    <th className="py-2 pr-3 font-medium">Number</th>
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Issued</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(({ invoice, clientName }) => (
                    <tr key={invoice.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/app/billing/invoices/${invoice.id}`}
                          className="text-indigo-700 hover:underline underline-offset-2 font-mono text-xs"
                        >
                          {formatInvoiceNumber(invoice.number)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{clientName}</td>
                      <td className="py-2 pr-3 text-slate-600">{invoice.issueDate}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={INVOICE_BADGE[invoice.status]}>
                          {INVOICE_STATUS_LABELS[invoice.status]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{formatCents(invoice.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent time</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-slate-400">No time recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Who</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ entry, clientName, userName }) => (
                    <tr key={entry.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs text-slate-600">{entry.workDate}</td>
                      <td className="py-2 pr-3">{clientName}</td>
                      <td className="py-2 pr-3 text-slate-600">{userName ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-700">{entry.description}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatMinutes(entry.minutes)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCents(entryAmountCents(entry))}</td>
                      <td className="py-2 pr-3">
                        {entry.invoiceId ? (
                          <Badge variant="accent">Invoiced</Badge>
                        ) : (
                          canManageFor(entry.clientId) && <DeleteEntryButton entryId={entry.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
