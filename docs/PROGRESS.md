# Progress

_Last updated: 2026-07-21 (M1 complete)_

## DONE
- **M0 — Foundation** (commit `M0: ...`): scaffold, RLS + OrgScope, better-auth
  with mandatory TOTP, permission matrix + audit, shells, tests, CI, docs.
- **M1 — SaaS shell** (commit `M1: ...`):
  - Signup → firm creation (/no-organization) with 14-day app-level trial;
    RLS-safe bootstrap (pre-generated org UUID + set_config).
  - Stripe (REAL test keys in .env, verified against the API): Checkout
    (per-seat quantity, remaining-trial carryover), signature-verified +
    idempotent webhooks (stripe_event table), Customer Portal link,
    success-redirect sync fallback for dev without `stripe listen`, seat-count
    sync on membership changes.
  - Grace mode: past_due/canceled or expired-unsubscribed trial ⇒ read-only
    (authorize() blocks non-view actions except billing.manage; red banner;
    write UIs disabled). Nothing is ever deleted.
  - Invitations: outbox-pattern email+SMS (console in dev), sha256-hashed
    tokens, 7-day expiry, revoke; /join/[token] accept flow (password or
    Google, email must match) → forced TOTP → personal dashboard.
  - Employees settings: invite/revoke, role changes (owner-gated for owner
    role, last-owner protection), deactivate/reactivate with seat sync.
  - Settings: firm profile (name/timezone), AI toggle, accountant scope mode,
    billing page. Dashboards: firm variant (owner/admin) vs personal
    (accountant/clerk) skeletons.
  - Tests: 37 Vitest (adds billing/webhook/grace/invite/bootstrap) + 5
    Playwright (adds invite→join→MFA→personal dashboard; lapse→read-only→
    restore). e2e reseeds automatically via globalSetup.

## IN PROGRESS
- Nothing — stopped at the M1 boundary.

## KNOWN BUGS / LIMITATIONS
- STRIPE_WEBHOOK_SECRET is a placeholder until `stripe listen` runs (Stripe
  CLI not installed on this machine). Dev relies on the success-redirect sync;
  install the CLI to test true webhook delivery + `stripe trigger` lapse events.
- Google-only accounts still can't enroll TOTP (twoFactor.enable needs a
  password). Join flow works via password path; Google-join users hit this on
  /setup-mfa. Candidate fix in M2: better-auth setPassword path for
  OAuth-only accounts.
- Customer Portal needs one-time activation in the Stripe test dashboard
  (Settings → Billing → Customer portal) — the UI shows a helpful error until
  then.
- Multi-org users still land in their first org (switcher deferred).
- checkout.session.completed relies on client_reference_id; sessions created
  outside the app (e.g. Payment Links) are ignored by design.

## NEEDS SATINDER'S / JOEY'S REVIEW
- **Pricing model**: Stripe price is $300 CAD/month and billing is PER SEAT
  (spec §1: quantity = active staff). A 4-person firm pays $1,200/month. If
  $300 was meant as flat-per-firm, change the price amount in Stripe or drop
  the quantity logic (one-line change in billing.ts) — decide before launch.
- ADR-0004 accountant_scope_mode default (carried over from M0).
- Deactivated employees free their seat immediately (prorated credit via
  Stripe proration). Confirm that's the desired seat policy.

## NEXT 3 CONCRETE STEPS (M2 — Client hub)
1. Schema: client (SIN encrypted via src/lib/crypto, custom_fields JSONB,
   assigned_accountant, preferred_channel, tags), household, engagement (+
   status enum + transition timestamps), note/contact-log tables + RLS.
2. Clients grid (TanStack Table: search, type filters, stage badges, owner,
   last contact — mirror design-reference clients page) + client detail
   (identity, household, tags, pinned notes, contact log, engagement
   transitions, assignment).
3. Workflow board (kanban by engagement status, filter by owner, drag =
   permission-checked transition) + dashboards wired to real engagement
   counts + accountant assigned-scope enforcement end-to-end.
