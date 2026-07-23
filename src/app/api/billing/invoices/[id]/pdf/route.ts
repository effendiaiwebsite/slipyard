import { NextResponse } from "next/server";
import { z } from "zod";
import { staffApiContext } from "@/lib/context";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import { authorize, PermissionError } from "@/lib/permissions";
import { formatInvoiceNumber } from "@/lib/timebilling";

/**
 * Invoice PDF download (M7, ADR-0030). Generated on demand from the invoice
 * row — never stored. Staff session required; audited as invoices.view.
 * Assigned-only accountants get a 404 for other books (no existence leak).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await staffApiContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const ctx = auth.ctx;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid invoice" }, { status: 400 });
  }

  const invoice = await ctx.scope.getInvoice(id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const client = await ctx.scope.getClient(invoice.clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    ctx.role === "accountant" &&
    ctx.orgSettings.accountant_scope_mode === "assigned_only" &&
    client.assignedAccountantId !== ctx.user.id
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "invoices.view",
      {
        orgId: invoice.orgId,
        type: "invoice",
        id: invoice.id,
        assignedTo: client.assignedAccountantId,
      },
      { orgSettings: ctx.orgSettings, details: { op: "download_pdf" } }
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    }
    throw e;
  }

  const address =
    [client.addressLine1, client.city, client.province, client.postalCode]
      .filter(Boolean)
      .join(", ") || null;
  const pdf = await generateInvoicePdf({
    invoice,
    firmName: ctx.orgName,
    clientName: client.displayName,
    clientAddress: address,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${formatInvoiceNumber(invoice.number)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
