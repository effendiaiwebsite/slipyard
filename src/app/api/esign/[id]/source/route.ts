import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffApiContext } from "@/lib/context";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import { getObjectBuffer } from "@/lib/storage";

/** Same denial-to-message pattern as the esign actions' local tryAuthorize. */
async function tryAuthorize(...args: Parameters<typeof authorize>): Promise<string | null> {
  try {
    await authorize(...args);
    return null;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return e.message;
    throw e;
  }
}

/**
 * Same-origin source-PDF bytes for the e-sign placement overlay (M10,
 * ADR-0037). The draft editor's pdf.js renderer fetches from here — a
 * presigned S3 URL can't be fetch()ed cross-origin without opening the
 * bucket's CORS. Gating mirrors getSourceViewUrl (signatures.view with the
 * client's assignment, audited).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const gate = await staffApiContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const ctx = gate.ctx;

  const request = await ctx.scope.getSignatureRequest(id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const client = await ctx.scope.getClient(request.clientId);
  const denied = await tryAuthorize(
    ctx.scope,
    ctx.actor,
    "signatures.view",
    {
      orgId: request.orgId,
      type: "signature_request",
      id: request.id,
      assignedTo: client?.assignedAccountantId,
    },
    { orgSettings: ctx.orgSettings, details: { op: "view_source_bytes" } }
  );
  if (denied) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await ctx.scope.getDocument(request.documentId);
  if (!doc || doc.status !== "clean") {
    return NextResponse.json({ error: "The document isn't available." }, { status: 404 });
  }

  const buffer = await getObjectBuffer(doc.s3Key);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
