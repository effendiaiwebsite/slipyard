import { NextResponse } from "next/server";
import { staffApiContext } from "@/lib/context";

/**
 * Scan-status poll (M5, ADR-0021): the upload UI asks "is it settled yet?"
 * after the async scan job took over. Staff session + org scope only; the
 * signature name is safe for staff eyes (same as the upload response was
 * pre-M5).
 */
export async function GET(request: Request) {
  const auth = await staffApiContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  }

  const doc = await auth.ctx.scope.getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  return NextResponse.json({
    status: doc.status,
    scanResult: doc.status === "infected" ? doc.scanResult : undefined,
  });
}
