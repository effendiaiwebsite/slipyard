# Decisions (ADR log — append only, dated)

## ADR-0001 (2026-07-21) — Auth table names prefixed, model-mapped
better-auth's default model names (user/session/account) are generic; we map
them to `staff_user` / `auth_session` / `auth_account` / `auth_verification` /
`auth_two_factor` via the drizzle adapter's schema option. Makes "staff ≠
firm-clients" explicit at the schema level (clients of firms NEVER get rows
here — portal is token-only).

## ADR-0002 (2026-07-21) — RLS via transaction-local GUCs + FORCE, role crm_app
Policies key on `current_setting('app.org_id')` set with `set_config(..., true)`
inside every OrgScope transaction. FORCE ROW LEVEL SECURITY + non-superuser
app role means even owner-connection mistakes stay safe. Secondary policy
(`user_id = app.user_id`) on org/org_membership enables the pre-org login
lookup without a bypass. Migrations/seeds run as DB owner and legitimately
bypass RLS.

## ADR-0003 (2026-07-21) — Invite/portal tokens stored as sha256 hashes
`invitation.token_hash` (and portal_token later) store a hash; the raw token
exists only in the sent link. A DB leak must not yield live links.

## ADR-0004 (2026-07-21) — accountant_scope_mode default 'all_read'
Spec leaves the default open ("confirm with customer"). Default: accountants
read all firm clients, write only assigned. Rationale: small-firm reality
(colleagues cover for each other); the restrictive mode exists as a per-org
setting. **Needs Joey's confirmation** — flagged in PROGRESS.md.

## ADR-0005 (2026-07-21) — Idle timeout enforced in requireStaff, not middleware
30-min idle is checked server-side against `auth_session.updated_at`
(better-auth updateAge=5 min keeps it ≈ last activity); absolute 12 h is
better-auth `expiresIn`. Next 16 middleware/proxy runtime constraints make a
DB-backed check there fragile; every staff page/handler already passes
through requireStaff. Revisit if we add long-polling surfaces.

## ADR-0006 (2026-07-21) — `pnpm run setup` (not `pnpm setup`)
`pnpm setup` is a pnpm builtin (installs pnpm itself) and shadows package
scripts. The M0 acceptance command is therefore `pnpm run setup && pnpm dev`.
Documented in README + CLAUDE.md.

## ADR-0007 (2026-07-21) — Local dev DB may be native Postgres, not Docker
docker-compose (PG16 + ClamAV) is in-repo and canonical, but this dev machine
has no Docker; a native PostgreSQL 17 service works identically for M0–M2
(scripts/setup.ts creates db + crm_app role either way). ClamAV becomes a
real requirement at M3 — revisit then. Drizzle/SQL kept compatible with PG16.

## ADR-0008 (2026-07-21) — Seed passwords hashed with better-auth's own hasher
scripts/seed.ts imports `hashPassword` from better-auth/crypto so seeded
credential rows are indistinguishable from signup-created ones; no test-only
auth backdoors.

## ADR-0009 (2026-07-21) — GUC-as-credential RLS pattern for pre-org lookups
Three flows must read tenant rows before an org context exists: login
(membership list), invite acceptance (token), Stripe webhooks (customer id).
Each gets a dedicated RLS policy keyed on a transaction-local GUC whose value
IS the credential (app.user_id from the session, app.invite_token_hash from
the presented link, app.stripe_customer_id from a signature-verified event).
Each policy exposes at most the rows that credential legitimately entitles.
No SECURITY DEFINER functions, no RLS bypass role.

## ADR-0010 (2026-07-21) — Checkout success-page sync alongside webhooks
Webhooks are the authoritative billing signal, but dev machines without the
Stripe CLI (and brief webhook outages in prod) would leave org status stale
after a successful Checkout. The billing page's success redirect re-fetches
the session server-side (verifying client_reference_id === org) and syncs.
Idempotent with the webhook path.

## ADR-0011 (2026-07-21) — Per-seat billing implemented as specced; price flagged
Spec §1: subscription quantity = active staff seats. Implemented (checkout
quantity, sync on membership changes, immediate proration on deactivation).
The customer-created Stripe price is $300/month, which per-seat may not be
the intent — flagged in PROGRESS.md for Joey; changing the amount is a
Stripe-dashboard-only operation.

## ADR-0012 (2026-07-21) — Flat per-firm pricing (customer decision; supersedes ADR-0011)
Joey confirmed: $300 CAD/month flat per firm, irrespective of staff count.
Checkout quantity is always 1; syncSeatQuantity and its call sites removed;
UI copy updated ("staff count never changes your bill"). The spec's per-seat
model (§1) is superseded by the customer's explicit direction. Reverting is
one line in billing.ts + a quantity-sync helper if ever needed.

## ADR-0013 (2026-07-21) — Engagement pipeline: 7 statuses, any→any transitions
engagement_status: not_started → awaiting_docs → in_preparation → in_review →
awaiting_signature → filed → noa_received. Spec only fixed the endpoints
("not_started→…→noa_received"); the middle mirrors a small firm's T1 flow and
the board's columns. Transitions are deliberately any→any (work moves
backwards in reality); safety comes from permission checks
(engagements.transition = assigned for accountants, deny for clerks), a
status_timestamps stamp per entry, and the audit log — not from a rigid state
machine. Revisit if M6 signing needs a hard filed-immutability gate.

## ADR-0014 (2026-07-21) — Auth rate limit relaxed outside production
better-auth rateLimit stays 30 req/min/IP in production, 300 otherwise: e2e
drives ~8 logins + TOTP enrollments from one IP (localhost) and tripped the
in-memory limiter mid-suite. Keyed on NODE_ENV, so no prod behavior change.
