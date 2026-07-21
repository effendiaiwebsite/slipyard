import { NextResponse } from "next/server";
import { getStripe, processStripeEvent } from "@/lib/billing";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Stripe webhook endpoint. Signature-verified (constructEvent) and
 * idempotent (stripe_event table). Dev: `stripe listen --forward-to
 * localhost:3000/api/webhooks/stripe` and put the printed whsec_ in .env.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "missing signature or webhook secret" }, { status: 400 });
  }

  const payload = await req.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    logger.warn("stripe webhook signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await processStripeEvent(event);
    logger.info({ eventId: event.id, type: event.type, outcome }, "stripe webhook");
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // 500 makes Stripe retry — correct for transient DB failures.
    logger.error({ err: e, eventId: event.id }, "stripe webhook processing failed");
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
