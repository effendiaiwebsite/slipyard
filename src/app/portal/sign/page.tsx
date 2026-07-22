import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requirePortal } from "@/lib/portal-context";

export const metadata = { title: "Sign a form" };

/** Placeholder until e-signature lands (M6). */
export default async function PortalSignPage() {
  await requirePortal();
  return (
    <div className="space-y-8">
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-2 font-semibold text-[#26374a] underline underline-offset-4"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden /> Back
      </Link>
      <h1>Sign a form</h1>
      <p>Nothing is waiting for your signature right now.</p>
      <p>
        When your accountant prepares a form for you to sign, it will appear here and they&apos;ll
        let you know.
      </p>
    </div>
  );
}
