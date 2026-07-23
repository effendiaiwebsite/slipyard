import { CheckSquare, FileUp, PenLine } from "lucide-react";
import Link from "next/link";
import { requirePortal } from "@/lib/portal-context";

export const metadata = { title: "Your portal" };

/**
 * Three-card home (M4). Exactly three actions — the portal's hard ceiling.
 * The "sign" card is a placeholder until M6.
 */
export default async function PortalHome() {
  const ctx = await requirePortal();
  const missingCount = await countMissing(ctx);
  const pendingSignatures = ctx.scopes.includes("sign")
    ? (await ctx.scope.listPendingSignatureRequestsForClients(ctx.clients.map((c) => c.id))).length
    : 0;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1>Hello {ctx.recipientName}</h1>
        {ctx.isHelper && (
          <p className="text-[17px] text-slate-600">
            You&apos;re helping with {ctx.client.displayName}&apos;s documents.
          </p>
        )}
      </div>

      <nav aria-label="What you can do here" className="space-y-4">
        <HomeCard
          href="/portal/upload"
          icon={<FileUp className="h-8 w-8" aria-hidden />}
          title="Send us a document"
          body="Take a photo of a paper, or send a file from your device."
        />
        <HomeCard
          href="/portal/checklist"
          icon={<CheckSquare className="h-8 w-8" aria-hidden />}
          title="What we still need"
          body={
            missingCount > 0
              ? `${missingCount} ${missingCount === 1 ? "document is" : "documents are"} still needed.`
              : "Nothing is missing right now."
          }
        />
        <HomeCard
          href="/portal/sign"
          icon={<PenLine className="h-8 w-8" aria-hidden />}
          title="Sign a form"
          body={
            pendingSignatures > 0
              ? `${pendingSignatures} ${pendingSignatures === 1 ? "form is" : "forms are"} ready to sign.`
              : "Nothing is waiting for your signature right now."
          }
        />
      </nav>
    </div>
  );
}

async function countMissing(ctx: Awaited<ReturnType<typeof requirePortal>>) {
  const engagements = await ctx.scope.listEngagementsForClients(ctx.clients.map((c) => c.id));
  const items = await ctx.scope.listChecklistItemsForEngagements(
    engagements.map((e) => e.engagement.id)
  );
  return items.filter((i) => i.status === "missing").length;
}

function HomeCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-5 rounded-xl border-2 border-[#26374a] bg-white p-6 hover:bg-slate-50"
    >
      <span className="text-[#26374a]">{icon}</span>
      <span>
        <span className="block text-xl font-bold text-[#26374a]">{title}</span>
        <span className="block text-[17px] text-slate-700">{body}</span>
      </span>
    </Link>
  );
}
