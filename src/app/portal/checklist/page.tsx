import { ArrowLeft, Check, Minus } from "lucide-react";
import Link from "next/link";
import { requirePortal } from "@/lib/portal-context";
import { PORTAL_ITEM_STATUS, portalEngagementLabel } from "@/lib/portal-labels";

export const metadata = { title: "What we still need" };

/**
 * Client-friendly checklist view (M4). Groups by person (household scope)
 * and return, in plain words. Missing items link straight to the upload
 * flow with the item preselected.
 */
export default async function PortalChecklistPage() {
  const ctx = await requirePortal();

  const engagements = await ctx.scope.listEngagementsForClients(ctx.clients.map((c) => c.id));
  const items = await ctx.scope.listChecklistItemsForEngagements(
    engagements.map((e) => e.engagement.id)
  );
  const itemsByEngagement = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByEngagement.get(item.engagementId) ?? [];
    list.push(item);
    itemsByEngagement.set(item.engagementId, list);
  }
  const withLists = engagements.filter((e) => (itemsByEngagement.get(e.engagement.id) ?? []).length > 0);
  const showNames = ctx.clients.length > 1;

  return (
    <div className="space-y-8">
      <Link href="/portal/home" className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4">
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <h1>What we still need</h1>

      {withLists.length === 0 && (
        <p>There&apos;s no document list for you right now. Nothing to do — we&apos;ll be in touch.</p>
      )}

      {withLists.map(({ engagement, clientName }) => {
        const list = itemsByEngagement.get(engagement.id) ?? [];
        const missing = list.filter((i) => i.status === "missing");
        return (
          <section key={engagement.id} className="space-y-3">
            <h2>
              {showNames && <span>{clientName} — </span>}
              {portalEngagementLabel(engagement.type, engagement.taxYear)}
            </h2>
            <ul className="space-y-3">
              {list.map((item) => {
                const meta = PORTAL_ITEM_STATUS[item.status];
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-300 bg-white px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {meta.tone === "done" && (
                        <Check className="h-6 w-6 shrink-0 text-[#00703c]" aria-hidden />
                      )}
                      {meta.tone === "skip" && (
                        <Minus className="h-6 w-6 shrink-0 text-slate-400" aria-hidden />
                      )}
                      {meta.tone === "todo" && (
                        <span
                          aria-hidden
                          className="h-6 w-6 shrink-0 rounded border-2 border-[#b10e1e]"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block font-semibold">{item.title}</span>
                        <span
                          className={
                            meta.tone === "todo"
                              ? "block font-semibold text-[#b10e1e]"
                              : "block text-slate-600"
                          }
                        >
                          {meta.label}
                        </span>
                      </span>
                    </div>
                    {item.status === "missing" && (
                      <Link
                        href={`/portal/upload?item=${item.id}`}
                        className="shrink-0 rounded-lg bg-[#26374a] px-4 py-2.5 font-bold text-white hover:bg-[#1c2b3a]"
                      >
                        Send it
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {missing.length === 0 && (
              <p className="font-semibold text-[#00703c]">
                Everything we need for this return is in. Thank you!
              </p>
            )}
          </section>
        );
      })}

      <p className="text-[17px] text-slate-600">
        Have something we didn&apos;t ask for?{" "}
        <Link href="/portal/upload" className="font-semibold text-[#26374a] underline underline-offset-4">
          Send us any document
        </Link>
        .
      </p>
    </div>
  );
}
