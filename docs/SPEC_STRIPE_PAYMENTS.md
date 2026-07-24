# Build spec — Client invoice payments (Stripe Connect)

_Status: SPEC ONLY — approved for design 2026-07-23, NOT scheduled. Build as
M11 when the current debugging pass is done. Nothing in this document is
implemented._

## Goal

A client can pay a SlipYard invoice online (credit card or Canadian
pre-authorized debit) and the invoice flips to `paid` automatically. The firm
receives the money directly in its own bank account; SlipYard never holds
funds. Competitive context: TaxDome's native payments are still USD-only and
Canopy's ACH is US-only — cards + Canadian PAD is a leapfrog feature
(docs/COMPETITIVE notes, 2026-07).

## Non-goals (v1)

- Partial payments, deposits, payment plans, surcharging/fee pass-through.
- Refunds from inside SlipYard (owner uses the Stripe dashboard; a webhook
  still records the refund against the payment row).
- Multi-currency — CAD only.
- Replacing the existing subscription billing (the firm paying SlipYard stays
  exactly as built in M1; this is firm-charges-client money, a separate
  Stripe surface).

## How it works (the accountant does NOT bring a Stripe account)

**Stripe Connect, Express account type.** SlipYard is the platform; each firm
gets a *connected account* created by us and onboarded through Stripe's
hosted flow:

1. Owner opens Settings → Payments → "Set up payments".
2. Server creates `stripe.accounts.create({ type: "express", country: "CA" })`,
   stores the account id on the org, mints an Account Link
   (`account_onboarding`) and redirects.
3. The firm enters business details + bank account **on Stripe's pages** —
   never on ours (keeps us out of banking-credential handling entirely).
   Takes ~10 minutes; resumable via a fresh Account Link if abandoned.
4. `account.updated` webhooks (and a return-URL sync, same belt-and-braces
   pattern as ADR-0010) record `charges_enabled` / `payouts_enabled` /
   `details_submitted` on the org. Payments UI unlocks only when
   `charges_enabled` is true.

**Charging model: direct charges on the connected account** (the standard
Express pattern): the Checkout Session is created `{ stripeAccount: acct_… }`,
funds settle to the firm, Stripe's fees hit the firm, and an optional
`application_fee_amount` is SlipYard's platform revenue (config, default 0 —
Joey decision; TaxDome/Karbon monetize here).

**Payment methods:** `card` and `acss_debit` (Canadian PAD). PAD is the money
line for accountants — roughly 1% + $0.40 capped vs ~2.9% + $0.30 on cards —
big on a $1,500 corporate-return invoice. PAD mandates and micro-deposit /
instant verification are handled inside Stripe Checkout; we store nothing but
the PaymentIntent id.

## Decisions to record at build time (ADR-0038…)

1. **Express, not Standard.** We control the experience, onboarding is
   minutes, firms don't need Stripe literacy. Trade-off: SlipYard carries
   platform obligations (negligible at this scale); revisit Standard only if
   a firm demands full Stripe dashboard ownership.
2. **Direct charges + application fee.** Simplest liability posture; fee
   defaults to 0 until Joey prices it.
3. **`paid` means money confirmation, not checkout completion.** Cards:
   `payment_intent.succeeded` fires ~immediately. PAD is asynchronous
   (settles in 3–5 business days): `checkout.session.completed` marks the
   payment row `processing`, only `payment_intent.succeeded` marks the
   invoice `paid`, `payment_intent.payment_failed` flips it back to `sent`
   with a contact-log entry. Invoice enum is untouched — the intermediate
   state lives on the payment row.
4. **Portal is the payment surface** (new `pay` scope), reusing the M4 token
   session — consistent with "clients never get accounts". A Stripe-hosted
   fallback link is NOT offered in v1 (one auth model, one surface).
5. **Payments run in grace mode.** A lapsed firm may still collect money owed
   to it (grace allowlist gains the new view/pay paths, mirroring
   `billing.manage`).

## Schema (new migration + RLS, FORCEd like everything else)

- `org` additions: `stripe_connect_account_id text`, `payments_enabled bool`
  (owner toggle), `connect_charges_enabled bool`, `connect_payouts_enabled
  bool`, `connect_details_submitted bool` (webhook-synced snapshots).
- New table `invoice_payment`: `id`, `org_id`, `invoice_id` FK,
  `stripe_checkout_session_id`, `stripe_payment_intent_id`, `amount_cents
  int`, `currency` (always 'cad' v1), `method` enum `card|acss_debit`,
  `status` enum `pending|processing|succeeded|failed|refunded`,
  `failure_reason text`, `paid_at`, timestamps. One open payment per invoice
  enforced in code (unique partial index on `invoice_id where status in
  ('pending','processing')`).
- `invoice` additions: `paid_via` enum `manual|stripe` (existing manual
  "mark paid" keeps working and stamps `manual`).

## Flows

**Send-for-payment:** invoice detail (staff) gains "Request payment" —
requires org `charges_enabled` + invoice status `sent`. Issues/reuses a
portal link with scopes `['view','pay']` via the existing portal-token
service and sends the M5 templated message (new default template
`invoice_ready` with `{invoice_number}`, `{amount}`, `{pay_link}`).

**Portal pay:** portal home gains a fourth card, "Pay your invoice" (only
when the token has `pay` and open invoices exist). AAA one-action-per-screen:
invoice summary (number, lines, total) → "Pay by bank (recommended)" or "Pay
by card" → server action creates the Checkout Session on the connected
account (`customer_email` prefilled, metadata `org_id/invoice_id/payment_id`)
→ redirect to Stripe → success/cancel return to portal pages. The success
page says "Payment received — your accountant will see it shortly" for cards
and "Payment started — bank payments take a few days" for PAD (keyed off the
payment row status, not the redirect).

**Webhooks:** new endpoint `/api/webhooks/stripe-connect` (separate signing
secret `STRIPE_CONNECT_WEBHOOK_SECRET`; Connect events carry `account` —
resolve org by `stripe_connect_account_id`, then run under that org's scope
via the GUC pattern, ADR-0009). Handled, idempotently by event id:
`checkout.session.completed`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `charge.refunded`, `account.updated`.
Success path: payment row → `succeeded`, invoice → `paid` + `paid_via
stripe`, contact-log entry, audit as system `invoices.payment_received`.

**Reconcile job:** pg-boss `payments-reconcile` (cron, like
reminders-sweep) re-queries Stripe for payment rows stuck
`pending|processing` > 7 days — webhook-miss insurance.

## Permissions

- New action `payments.manage` (connect onboarding, toggle, request payment):
  owner/admin allow, accountant/clerk deny. Grace-allowed.
- `invoices.view` covers seeing payment status (all roles, unchanged).
- Portal side is scope-gated (`pay`), not role-gated, like `sign`.

## Env / config

`STRIPE_CONNECT_WEBHOOK_SECRET` (optionalStr; payments features gate on it +
`STRIPE_SECRET_KEY`, same `features.stripe` pattern in env.ts).
`PLATFORM_FEE_BPS` (default 0). Dev uses Stripe test mode + `stripe listen
--forward-connect-to`; document in TESTING.md.

## Security notes

- Card/bank data never touches SlipYard (Stripe-hosted Checkout) → PCI
  SAQ-A. We store only Stripe ids and integer cents (ADR-0030 money rules).
- Per the app-wide iron rule: staff/portal UIs never display full banking
  details; payment rows carry none.
- Webhook handlers verify signatures and are idempotent (M1 pattern);
  amounts on the payment row are snapshots — the invoice's snapshot totals
  (ADR-0030) remain the source of truth, and Checkout is created from them
  server-side (client never posts an amount).

## Tests / acceptance

- Vitest: payment state machine (session→processing→succeeded/failed),
  webhook idempotency (replayed event id is a no-op), org resolution from
  `account` id, cross-org isolation via red-team probes on `invoice_payment`,
  permission matrix row for `payments.manage`, invoice stays snapshot-true.
  Stripe SDK mocked (same posture as Twilio/SES adapters).
- Playwright ACCEPTANCE (env-gated on test-mode keys, like real-provider
  checks): request payment → portal card visible → Checkout session created
  (assert redirect URL shape) → simulate webhook → invoice shows Paid, the
  contact log shows the receipt entry.
- Manual (Satinder): full Stripe test-mode run with `4242…` card and the
  ACSS test institution; verify Express onboarding on a real phone browser.

## Open questions for Joey

1. Platform fee: 0 for the first customer, or price it now?
2. Should the invoice-ready message auto-send when an invoice is marked
   `sent`, or stay a manual "Request payment" button? (Spec assumes manual —
   consistent with the no-auto-send posture.)
