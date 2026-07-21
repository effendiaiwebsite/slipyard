# Testing

## Commands
| what | command | needs |
|---|---|---|
| Unit/integration (Vitest) | `pnpm test` | migrated DB (`pnpm db:migrate`), .env |
| E2E (Playwright, spins up dev server) | `pnpm test:e2e` | seeded DB (`pnpm db:seed`); first time: `pnpm exec playwright install chromium` |
| Types / lint | `pnpm typecheck` / `pnpm lint` | — |
| Everything CI runs | typecheck, lint, db:migrate, test, build | see `.github/workflows/ci.yml` |

e2e reseeds automatically before every run (globalSetup) — the dev DB is
wiped to the deterministic baseline each time. Vitest DB tests create their
own fixtures (random UUIDs) and clean up — they don't depend on the seed.

## Automated coverage (M0)
- `tests/tenancy.test.ts` — the #1 invariant, both layers:
  - OrgScope returns only scoped-org rows (memberships, org, audit).
  - Pre-org membership lookup sees own rows only.
  - Raw SQL as `crm_app`: no rows without GUC; org-A context can't SELECT
    org-B; cross-org INSERT rejected by WITH CHECK; audit_log UPDATE/DELETE
    → permission denied (append-only).
- `tests/permissions.test.ts` — full matrix per role; accountant
  assigned-write semantics; assigned_only narrowing; cross-org resource →
  TenancyViolationError (hard error, all roles).
- `tests/crypto.test.ts` — SIN encrypt/decrypt roundtrip, random IV, unknown
  key id rejected, GCM tamper detection, masking, Luhn.
- `e2e/auth.spec.ts` — shells render; unauthenticated /app → /login; full
  login → forced TOTP enrollment (secret harvested from manual-entry
  fallback, code via otplib) → dashboard.

## Automated coverage (M1)
- `tests/billing.test.ts` — mapStripeStatus exhaustive; webhook processing
  updates org via customer-id GUC policy; per-event-id idempotency
  (duplicate ⇒ no-op); subscription.deleted cancels + clears sub id; unknown
  customer ignored; signature verification accept/reject
  (generateTestHeaderString); computeReadOnly matrix; authorize() in
  read-only org blocks writes (audit `blocked_read_only:*`), allows views +
  billing.manage.
- `tests/invites.test.ts` — token hash hygiene; invitationProblem branches;
  invite invisible to raw app-role SQL without context; token-hash GUC
  lookup exposes exactly one row; accept creates membership + stamps invite;
  createOrgForUser bootstrap under RLS (owner membership, trial date,
  isolation from other orgs).
- `e2e/m1.spec.ts` — owner invites → link harvested from outbox → invitee
  creates account → forced TOTP → personal (clerk) dashboard; org status
  'canceled' ⇒ read-only banner + disabled write UI + views still render,
  restore ⇒ normal.

## Manual checklist — M1 (verified 2026-07-21)
- [x] Real Stripe test keys verified: price listed via API; checkout session
  created + expired via smoke script (per-seat quantity, 14-day trial).
- [x] Full e2e suite (5 tests) green against seeded dev DB.
- [x] True webhook delivery: `stripe listen --forward-to
  localhost:3000/api/webhooks/stripe` + `stripe trigger
  customer.subscription.updated` → signature verified, events recorded in
  stripe_event (verified 2026-07-21).
- [x] Customer Portal activated via API (default configuration) + portal
  session smoke-tested.
- [ ] Google OAuth login round-trip — keys configured; verify redirect URI
  in Google console on first manual login.

## Manual checklist — M0 (verified 2026-07-21)
- [x] `pnpm run setup` on a machine with local Postgres → .env generated, db
  + crm_app role created, migrated, seeded.
- [x] `pnpm dev` → landing page at /, staff login at /login.
- [x] Login joey@lakesidecpa.test → forced to /setup-mfa; QR scans in
  authenticator; wrong code rejected; correct code → dashboard. (Automated
  equivalent runs in e2e with priya@.)
- [x] /app without session redirects to /login.
- [x] /portal renders large-type placeholder.
- [x] Sidebar shows Practice/Tax/Clients/AI/Settings (no bookkeeping/payroll).

## Priority areas (spec §1)
Tenancy isolation · permissions · tokens · presign (M3) · Stripe webhooks
(M1). Every milestone adds its rows here with evidence.
