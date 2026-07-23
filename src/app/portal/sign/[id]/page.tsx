import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/portal-context";
import { markSignatureViewed } from "@/lib/esign";
import { PortalSignFlow } from "./portal-sign-flow";

export const metadata = { title: "Sign a form" };

/**
 * Portal signing surface (M6, AAA). The signer reviews the form, then draws or
 * types their signature. Ownership + the 'sign' scope are checked here and
 * again in the submit action.
 */
export default async function PortalSignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePortal();

  if (!ctx.scopes.includes("sign")) redirect("/portal/sign");

  const request = await ctx.scope.getSignatureRequest(id);
  const owned = request && ctx.clients.some((c) => c.id === request.clientId);
  if (!request || !owned) redirect("/portal/sign");

  if (request.status === "signed") {
    return <AlreadyDone title={request.title} kind="signed" />;
  }
  if (request.status === "declined" || request.status === "canceled") {
    return <AlreadyDone title={request.title} kind="closed" />;
  }

  // Mark that the signer opened it (sent → viewed); best-effort.
  await markSignatureViewed(ctx.scope, request);

  return (
    <div className="space-y-8">
      <Link
        href="/portal/sign"
        className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <div className="space-y-2">
        <h1>Sign &ldquo;{request.title}&rdquo;</h1>
        <p className="text-[17px] text-slate-700">
          Please review the form first, then add your signature below.
        </p>
      </div>

      <PortalSignFlow requestId={request.id} signerName={request.signerName} />
    </div>
  );
}

function AlreadyDone({ title, kind }: { title: string; kind: "signed" | "closed" }) {
  return (
    <div className="space-y-6">
      <Link
        href="/portal/sign"
        className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <h1>{kind === "signed" ? "Already signed" : "This form is closed"}</h1>
      <p>
        {kind === "signed"
          ? `Thank you — “${title}” has already been signed.`
          : `“${title}” is no longer open for signing. If you have questions, please call the office.`}
      </p>
    </div>
  );
}
