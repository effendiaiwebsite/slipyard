import "server-only";
import Stripe from "stripe";
import {
  findOrgByStripeCustomer,
  recordStripeEventOnce,
  updateOrgBillingState,
  OrgScope,
} from "@/db/scoped";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { StaffContext } from "@/lib/context";

/**
 * Stripe billing (§1): monthly plan, quantity = active staff seats, 14-day
 * trial, Checkout + Customer Portal, webhooks drive org.subscription_status.
 * Lapsed ⇒ read-only grace mode (computeReadOnly/authorize), never deletion.
 *
 * Dev without `stripe listen`: the Checkout success redirect triggers
 * syncCheckoutSuccess() as a fallback, so status updates even when webhooks
 * can't reach localhost. Webhooks remain the authoritative path.
 */

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!features.stripe) {
    throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY (see .env.example)");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY!);
  }
  return stripeClient;
}

/** Map a Stripe subscription status onto our org enum. */
export function mapStripeStatus(
  s: Stripe.Subscription.Status
): "trialing" | "active" | "past_due" | "canceled" {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
  }
}

export async function activeSeatCount(scope: OrgScope): Promise<number> {
  const members = await scope.listMemberships();
  return members.filter((m) => m.membership.status === "active").length;
}

function remainingTrialDays(trialEndsAt: Date | null): number {
  if (!trialEndsAt) return 0;
  const days = Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(14, days));
}

/** Create (or reuse) the Stripe customer for an org. */
async function ensureCustomer(ctx: StaffContext): Promise<string> {
  if (ctx.stripeCustomerId) return ctx.stripeCustomerId;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: ctx.orgName,
    email: ctx.user.email,
    metadata: { orgId: ctx.orgId },
  });
  await updateOrgBillingState(ctx.orgId, { stripeCustomerId: customer.id }, "ensureCustomer");
  return customer.id;
}

export async function createCheckoutSession(ctx: StaffContext): Promise<string> {
  const stripe = getStripe();
  if (!env.STRIPE_PRICE_ID) throw new Error("STRIPE_PRICE_ID is not set");
  const customer = await ensureCustomer(ctx);
  const seats = await activeSeatCount(ctx.scope);
  const trialDays = remainingTrialDays(ctx.trialEndsAt);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: ctx.orgId,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: seats }],
    subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
    success_url: `${env.APP_URL}/app/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/app/settings/billing?canceled=1`,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(ctx: StaffContext): Promise<string> {
  const stripe = getStripe();
  if (!ctx.stripeCustomerId) throw new Error("No Stripe customer yet — subscribe first");
  const session = await stripe.billingPortal.sessions.create({
    customer: ctx.stripeCustomerId,
    return_url: `${env.APP_URL}/app/settings/billing`,
  });
  return session.url;
}

/**
 * Success-redirect fallback sync. Verifies the session belongs to THIS org
 * before trusting it (session id arrives via query string).
 */
export async function syncCheckoutSuccess(ctx: StaffContext, sessionId: string): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  if (session.client_reference_id !== ctx.orgId) {
    logger.warn({ orgId: ctx.orgId }, "checkout session org mismatch — ignoring");
    return;
  }
  const sub = session.subscription as Stripe.Subscription | null;
  if (!sub) return;
  await updateOrgBillingState(
    ctx.orgId,
    {
      stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: mapStripeStatus(sub.status),
    },
    "checkout_success_sync"
  );
}

/** Keep subscription quantity = active seats. No-op before first Checkout. */
export async function syncSeatQuantity(
  scope: OrgScope,
  stripeSubscriptionId: string | null
): Promise<void> {
  if (!stripeSubscriptionId || !features.stripe) return;
  const stripe = getStripe();
  const seats = await activeSeatCount(scope);
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item || item.quantity === seats) return;
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: seats }],
    proration_behavior: "create_prorations",
  });
  logger.info({ orgId: scope.orgId, seats }, "stripe seat quantity synced");
}

/**
 * Webhook processing. Caller has already verified the signature. Returns a
 * short outcome string for logging/tests.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<string> {
  const fresh = await recordStripeEventOnce(event.id, event.type);
  if (!fresh) return "duplicate";

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const orgId = session.client_reference_id;
      if (!orgId) return "no_org_ref";
      await updateOrgBillingState(
        orgId,
        {
          stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : undefined,
          // Definitive status arrives via customer.subscription.updated;
          // checkout completion at minimum means an active-or-trialing sub.
        },
        `webhook:${event.type}`
      );
      return "checkout_completed";
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const org = await findOrgByStripeCustomer(customerId);
      if (!org) return "org_not_found";
      const status =
        event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(sub.status);
      await updateOrgBillingState(
        org.id,
        {
          subscriptionStatus: status,
          stripeSubscriptionId: event.type === "customer.subscription.deleted" ? null : sub.id,
        },
        `webhook:${event.type}`
      );
      return `status:${status}`;
    }
    default:
      return "ignored";
  }
}
