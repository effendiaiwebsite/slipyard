import { ArrowLeft, PenLine } from "lucide-react";
import Link from "next/link";
import { requirePortal } from "@/lib/portal-context";

export const metadata = { title: "Sign a form" };

/**
 * Portal "Sign a form" (M6): lists the forms waiting for this signer. Remote
 * signing lives inside the portal session (ADR-0026) — the token must carry
 * the 'sign' scope. Big-type AAA theme for the elderly audience.
 */
export default async function PortalSignPage() {
  const ctx = await requirePortal();

  const canSign = ctx.scopes.includes("sign");
  const pending = canSign
    ? await ctx.scope.listPendingSignatureRequestsForClients(ctx.clients.map((c) => c.id))
    : [];

  return (
    <div className="space-y-8">
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <h1>Sign a form</h1>

      {!canSign ? (
        <p>
          When your accountant prepares a form for you to sign, they&apos;ll send you a new link.
          Please use the newest message from their office.
        </p>
      ) : pending.length === 0 ? (
        <p>Nothing is waiting for your signature right now.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[17px] text-slate-700">
            {pending.length === 1
              ? "One form is ready for you to sign."
              : `${pending.length} forms are ready for you to sign.`}
          </p>
          {pending.map(({ request, clientName }) => (
            <Link
              key={request.id}
              href={`/portal/sign/${request.id}`}
              className="flex items-center gap-5 rounded-xl border-2 border-[#26374a] bg-white p-6 hover:bg-slate-50"
            >
              <span className="text-[#26374a]">
                <PenLine className="h-8 w-8" aria-hidden />
              </span>
              <span>
                <span className="block text-xl font-bold text-[#26374a]">{request.title}</span>
                {ctx.clients.length > 1 && (
                  <span className="block text-[17px] text-slate-700">for {clientName}</span>
                )}
                <span className="block text-[17px] text-slate-700">Tap to review and sign.</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
