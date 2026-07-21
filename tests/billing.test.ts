import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { OrgScope } from "@/db/scoped";
import { mapStripeStatus, processStripeEvent } from "@/lib/billing";
import { computeReadOnly } from "@/lib/context";
import { authorize, ReadOnlyOrgError } from "@/lib/permissions";
import { adminUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

let f: Fixture;
const customerId = `cus_test_${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  f = await createFixture();
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  await c.query(`update org set stripe_customer_id = $1 where id = $2`, [customerId, f.orgA]);
  await c.end();
});

afterAll(async () => {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  await c.query(`delete from stripe_event where id like 'evt_test_%'`);
  await c.end();
  await destroyFixture(f);
  await pool.end();
});

function subscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  status: Stripe.Subscription.Status
): Stripe.Event {
  return {
    id: `evt_test_${randomUUID().slice(0, 12)}`,
    type,
    data: {
      object: { id: "sub_test_1", customer: customerId, status } as Stripe.Subscription,
    },
  } as Stripe.Event;
}

describe("mapStripeStatus", () => {
  it("maps every Stripe status onto the org enum", () => {
    expect(mapStripeStatus("trialing")).toBe("trialing");
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("incomplete")).toBe("past_due");
    expect(mapStripeStatus("paused")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
  });
});

describe("webhook processing", () => {
  it("updates org status from subscription events, resolving org by customer id", async () => {
    const outcome = await processStripeEvent(subscriptionEvent("customer.subscription.updated", "past_due"));
    expect(outcome).toBe("status:past_due");
    const org = await new OrgScope(f.orgA, f.userA).getOrg();
    expect(org?.subscriptionStatus).toBe("past_due");
  });

  it("is idempotent per event id", async () => {
    const event = subscriptionEvent("customer.subscription.updated", "active");
    expect(await processStripeEvent(event)).toBe("status:active");
    expect(await processStripeEvent(event)).toBe("duplicate");
  });

  it("subscription.deleted cancels and clears the subscription id", async () => {
    const outcome = await processStripeEvent(subscriptionEvent("customer.subscription.deleted", "canceled"));
    expect(outcome).toBe("status:canceled");
    const org = await new OrgScope(f.orgA, f.userA).getOrg();
    expect(org?.subscriptionStatus).toBe("canceled");
    expect(org?.stripeSubscriptionId).toBeNull();
  });

  it("ignores events for unknown customers", async () => {
    const event = {
      id: `evt_test_${randomUUID().slice(0, 12)}`,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_x", customer: "cus_does_not_exist", status: "active" } },
    } as unknown as Stripe.Event;
    expect(await processStripeEvent(event)).toBe("org_not_found");
  });
});

describe("webhook signature verification", () => {
  it("accepts a correctly signed payload and rejects a wrong secret", async () => {
    const payload = JSON.stringify({ id: "evt_sig_test", object: "event", type: "ping" });
    const secret = "whsec_test_secret";
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = await Stripe.webhooks.constructEventAsync(payload, header, secret);
    expect(event.id).toBe("evt_sig_test");
    await expect(
      Stripe.webhooks.constructEventAsync(payload, header, "whsec_wrong")
    ).rejects.toThrow();
  });
});

describe("grace mode (read-only org)", () => {
  const base = { trialEndsAt: null, stripeSubscriptionId: "sub_1" };

  it("computeReadOnly flags lapsed and expired-trial orgs", () => {
    expect(computeReadOnly({ subscriptionStatus: "active", ...base })).toBe(false);
    expect(computeReadOnly({ subscriptionStatus: "trialing", ...base })).toBe(false);
    expect(computeReadOnly({ subscriptionStatus: "past_due", ...base })).toBe(true);
    expect(computeReadOnly({ subscriptionStatus: "canceled", ...base })).toBe(true);
    // Trial expired without ever subscribing:
    expect(
      computeReadOnly({
        subscriptionStatus: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: new Date(Date.now() - 1000),
      })
    ).toBe(true);
    // Trial still running, not subscribed:
    expect(
      computeReadOnly({
        subscriptionStatus: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: new Date(Date.now() + 86_400_000),
      })
    ).toBe(false);
  });

  it("authorize blocks writes but allows views and billing.manage", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const actor = { userId: f.userA, orgId: f.orgA, role: "owner" as const };
    const resource = { orgId: f.orgA, type: "org", id: f.orgA };

    await expect(
      authorize(scope, actor, "employees.invite", resource, { readOnlyOrg: true })
    ).rejects.toThrow(ReadOnlyOrgError);
    await expect(
      authorize(scope, actor, "clients.view", resource, { readOnlyOrg: true })
    ).resolves.toBeUndefined();
    await expect(
      authorize(scope, actor, "billing.manage", resource, { readOnlyOrg: true })
    ).resolves.toBeUndefined();

    const audit = await scope.listAudit(20);
    expect(audit.some((a) => a.action === "blocked_read_only:employees.invite")).toBe(true);
  });
});
