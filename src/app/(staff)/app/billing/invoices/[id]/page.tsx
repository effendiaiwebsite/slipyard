import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import {
  formatCents,
  formatInvoiceNumber,
  formatMinutes,
  INVOICE_STATUS_LABELS,
} from "@/lib/timebilling";
import { InvoiceStatusButtons } from "../../billing-forms";

export const metadata = { title: "Invoice" };

const INVOICE_BADGE = {
  draft: "default",
  sent: "accent",
  paid: "success",
  void: "danger",
} as const;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();

  const invoice = await ctx.scope.getInvoice(id);
  if (!invoice) notFound();
  const client = await ctx.scope.getClient(invoice.clientId);
  if (!client) notFound();

  const resource = {
    orgId: invoice.orgId,
    type: "client",
    id: client.id,
    assignedTo: client.assignedAccountantId,
  };
  // Assigned-only accountants shouldn't discover other books via invoice ids.
  if (
    ctx.role === "accountant" &&
    ctx.orgSettings.accountant_scope_mode === "assigned_only" &&
    client.assignedAccountantId !== ctx.user.id
  ) {
    notFound();
  }
  const canManage = !ctx.readOnly && can(ctx.actor, "invoices.manage", resource, ctx.orgSettings);

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">
            <Link href="/app/billing" className="hover:underline">
              Time &amp; billing
            </Link>{" "}
            · {formatInvoiceNumber(invoice.number)}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">
              {formatInvoiceNumber(invoice.number)}
            </h1>
            <Badge variant={INVOICE_BADGE[invoice.status]}>
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            <Link
              href={`/app/clients/${client.id}`}
              className="text-indigo-700 hover:underline underline-offset-2"
            >
              {client.displayName}
            </Link>{" "}
            · issued {invoice.issueDate}
            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/billing/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
              <Download /> Download PDF
            </a>
          </Button>
          {canManage && <InvoiceStatusButtons invoiceId={invoice.id} status={invoice.status} />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Rate/h</th>
                <th className="py-2 pl-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2 pr-3 text-slate-700">{line.description}</td>
                  <td className="py-2 pr-3 text-slate-600">{formatMinutes(line.minutes)}</td>
                  <td className="py-2 pr-3 text-slate-600">{formatCents(line.rateCents)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {formatCents(line.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-4 ml-auto w-56 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums">{formatCents(invoice.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{invoice.taxLabel}</dt>
              <dd className="tabular-nums">{formatCents(invoice.taxCents)}</dd>
            </div>
            <div className="flex justify-between font-semibold border-t border-[var(--color-border)] pt-1.5">
              <dt>Total (CAD)</dt>
              <dd className="tabular-nums" data-testid="invoice-total">
                {formatCents(invoice.totalCents)}
              </dd>
            </div>
          </dl>
          {invoice.notes && <p className="mt-4 text-sm text-slate-600">{invoice.notes}</p>}
          {invoice.status === "void" && (
            <p className="mt-4 text-xs text-slate-500">
              Voided — its time entries returned to unbilled work.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
