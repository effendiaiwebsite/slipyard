import Link from "next/link";
import { Sidebar } from "@/components/staff/sidebar";
import { Topbar } from "@/components/staff/topbar";
import { requireStaff } from "@/lib/context";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  clerk: "Clerk",
};

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // The gate: session + mandatory MFA + idle timeout + org membership.
  const ctx = await requireStaff();

  const trialDaysLeft = ctx.trialEndsAt
    ? // eslint-disable-next-line react-hooks/purity -- async server component; renders per request
      Math.max(0, Math.ceil((ctx.trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;
  const showTrialBanner =
    ctx.subscriptionStatus === "trialing" && !ctx.stripeSubscriptionId && !ctx.readOnly;

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar orgName={ctx.orgName} userName={ctx.user.name} roleLabel={roleLabels[ctx.role]} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        {ctx.readOnly && (
          <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm px-6 py-2.5 print:hidden">
            <strong>Read-only mode.</strong> The subscription is inactive — all data is safe and
            viewable, but changes are paused.{" "}
            {ctx.role === "owner" ? (
              <Link href="/app/settings/billing" className="underline underline-offset-2">
                Restore billing
              </Link>
            ) : (
              <>Ask the firm owner to restore billing.</>
            )}
          </div>
        )}
        {showTrialBanner && (
          <div className="bg-indigo-50 border-b border-indigo-100 text-indigo-800 text-sm px-6 py-2.5 print:hidden">
            Free trial — {trialDaysLeft} day(s) remaining.{" "}
            {ctx.role === "owner" && (
              <Link href="/app/settings/billing" className="underline underline-offset-2">
                Add a payment method
              </Link>
            )}
          </div>
        )}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
