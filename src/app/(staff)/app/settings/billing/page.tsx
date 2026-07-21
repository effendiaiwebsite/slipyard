import { syncCheckoutSuccess, activeSeatCount } from "@/lib/billing";
import { requireStaff } from "@/lib/context";
import { features } from "@/lib/env";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingButtons } from "./billing-buttons";

export const metadata = { title: "Billing" };

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "warn" | "danger" | "accent" }> = {
  trialing: { label: "Trial", variant: "accent" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Past due", variant: "warn" },
  canceled: { label: "Canceled", variant: "danger" },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; canceled?: string }>;
}) {
  let ctx = await requireStaff();
  const params = await searchParams;

  // Success-redirect fallback sync (covers dev without `stripe listen`).
  if (params.session_id && features.stripe && can(ctx.actor, "billing.manage")) {
    await syncCheckoutSuccess(ctx, params.session_id);
    ctx = await requireStaff(); // re-read updated org state
  }

  const canManage = can(ctx.actor, "billing.manage");
  const seats = await activeSeatCount(ctx.scope);
  const badge = STATUS_BADGE[ctx.subscriptionStatus];
  const trialDaysLeft = ctx.trialEndsAt
    ? // eslint-disable-next-line react-hooks/purity -- async server component; renders per request
      Math.max(0, Math.ceil((ctx.trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-slate-500 mt-1">
          Flat monthly subscription per firm — unlimited staff.
        </p>
      </div>

      {params.session_id && (
        <Card>
          <CardContent className="p-4 text-sm text-emerald-800 bg-emerald-50 rounded-lg">
            Checkout complete — welcome aboard. Your subscription status is shown below.
          </CardContent>
        </Card>
      )}
      {params.canceled && (
        <Card>
          <CardContent className="p-4 text-sm text-slate-600">
            Checkout was canceled — no changes made.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            Subscription <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardTitle>
          <CardDescription>
            {ctx.subscriptionStatus === "trialing" && !ctx.stripeSubscriptionId && (
              <>
                Free trial{trialDaysLeft !== null && <> — {trialDaysLeft} day(s) remaining</>}. Add a
                payment method before it ends to keep full access.
              </>
            )}
            {ctx.subscriptionStatus === "trialing" && ctx.stripeSubscriptionId && (
              <>Trial with payment method on file — converts automatically when the trial ends.</>
            )}
            {ctx.subscriptionStatus === "active" && <>Your subscription is active.</>}
            {(ctx.subscriptionStatus === "past_due" || ctx.subscriptionStatus === "canceled") && (
              <>
                The firm is in <strong>read-only mode</strong>: all data remains available, but
                changes are paused until billing is restored. Nothing is ever deleted.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-slate-600">
            Active staff: <strong>{seats}</strong>. Staff count never changes your bill.
          </div>
          {!features.stripe ? (
            <p className="text-sm text-amber-700">
              Stripe keys are not configured (see .env.example) — billing actions are disabled.
            </p>
          ) : canManage ? (
            <BillingButtons
              hasSubscription={!!ctx.stripeSubscriptionId}
              hasCustomer={!!ctx.stripeCustomerId}
            />
          ) : (
            <p className="text-sm text-slate-500">Only the firm owner can manage billing.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
