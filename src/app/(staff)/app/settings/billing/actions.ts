"use server";

import { redirect } from "next/navigation";
import { createCheckoutSession, createPortalSession } from "@/lib/billing";
import { requireStaff } from "@/lib/context";
import { logger } from "@/lib/logger";
import { authorize } from "@/lib/permissions";

export async function startCheckout(): Promise<{ error: string } | never> {
  const ctx = await requireStaff();
  // billing.manage is allowed even in read-only grace mode — it's the way out.
  await authorize(ctx.scope, ctx.actor, "billing.manage", { orgId: ctx.orgId, type: "org", id: ctx.orgId }, {
    details: { op: "start_checkout" },
  });
  let url: string;
  try {
    url = await createCheckoutSession(ctx);
  } catch (e) {
    logger.error({ err: e, orgId: ctx.orgId }, "checkout session creation failed");
    return { error: e instanceof Error ? e.message : "Could not start checkout" };
  }
  redirect(url);
}

export async function openBillingPortal(): Promise<{ error: string } | never> {
  const ctx = await requireStaff();
  await authorize(ctx.scope, ctx.actor, "billing.manage", { orgId: ctx.orgId, type: "org", id: ctx.orgId }, {
    details: { op: "open_portal" },
  });
  let url: string;
  try {
    url = await createPortalSession(ctx);
  } catch (e) {
    logger.error({ err: e, orgId: ctx.orgId }, "portal session creation failed");
    return {
      error:
        "Could not open the Stripe portal. In test mode, enable the Customer Portal once in the Stripe dashboard (Settings → Billing → Customer portal).",
    };
  }
  redirect(url);
}
