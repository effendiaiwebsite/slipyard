import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requirePortal } from "@/lib/portal-context";
import { portalEngagementLabel } from "@/lib/portal-labels";
import { UploadFlow } from "./upload-flow";

export const metadata = { title: "Send us a document" };

/**
 * Portal upload (M4). Server side gathers who the token covers and which
 * checklist items are still missing; the client flow handles person → item
 * → photo/file → send. `?item=` preselects a checklist item ("Send it").
 */
export default async function PortalUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const ctx = await requirePortal();
  const { item: preselectedItemId } = await searchParams;

  const engagements = await ctx.scope.listEngagementsForClients(ctx.clients.map((c) => c.id));
  const items = await ctx.scope.listChecklistItemsForEngagements(
    engagements.map((e) => e.engagement.id)
  );
  const engagementById = new Map(engagements.map((e) => [e.engagement.id, e]));

  const missingItems = items
    .filter((i) => i.status === "missing")
    .map((i) => {
      const eng = engagementById.get(i.engagementId)!;
      return {
        id: i.id,
        title: i.title,
        clientId: eng.engagement.clientId,
        engagementLabel: portalEngagementLabel(eng.engagement.type, eng.engagement.taxYear),
      };
    });

  const canUpload = ctx.scopes.includes("upload");

  return (
    <div className="space-y-8">
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <h1>Send us a document</h1>
      {canUpload ? (
        <UploadFlow
          clients={ctx.clients.map((c) => ({ id: c.id, name: c.displayName }))}
          defaultClientId={ctx.client.id}
          missingItems={missingItems}
          preselectedItemId={preselectedItemId ?? null}
        />
      ) : (
        <p>This link doesn&apos;t allow sending documents. Please call your accountant&apos;s office.</p>
      )}
    </div>
  );
}
