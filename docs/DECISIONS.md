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
Addendum (same day): better-auth's stricter BUILT-IN per-path rules
(/sign-in/email, /two-factor/*) also trip under e2e; dev/test overrides them
to 30/10s via customRules. Production keeps all built-in path rules.

## ADR-0015 (2026-07-21) — Workflow stages are per-org rows, anchored by fixed categories
Customer request: firms must be able to rename/add/remove/reorder pipeline
stages. engagement_status enum replaced by an engagement_stage table (org_id,
immutable key slug, label, category, position); every org starts from the
7-stage default template (org bootstrap + seed + 0008 backfill). The category
enum (not_started/awaiting_docs/in_progress/awaiting_signature/filed/complete)
is FIXED and is the only thing automations may reference — M3 checklists, M5
reminders, M6 signing hook categories, never labels or keys. Guardrails:
stage keys immutable (renames touch labels), min 2 stages, deleting an
in-use stage requires choosing a destination for its engagements, engagement
FK is ON DELETE RESTRICT as the backstop. Managed in Settings → Workflow
stages, gated by org.update_settings. Supersedes the "show Joey the enum"
review item from ADR-0013 — Joey now edits the template himself.

## ADR-0016 (2026-07-22) — M3 upload pipeline: app-proxied multipart + synchronous scan
The architecture sketch said "browser → presigned POST → pg-boss scan job",
but the stack decision defers pg-boss to M5, and presigned browser POSTs
need bucket CORS + orphaned-object lifecycle handling. At small-firm scale
(25 MB cap) M3 instead proxies uploads through a route handler
(/api/vault/upload): bytes → org/{orgId}/quarantine/ → ClamAV INSTREAM scan
synchronously in the request → promote to vault/ (CopyObject+Delete) or
flag. Scanner unavailable ⇒ status scan_failed (retryable via
documents.manage) — NEVER treated as clean. Reads stay presigned GETs
(5 min), so document bytes never stream through the app on the read path.
The route enforces same-origin (Origin header) because cookie-authed
multipart POSTs skip CORS preflight and route handlers lack the server
actions' built-in origin check. Revisit at M4 (phone/pipeline volume) and
M5 (move scanning to pg-boss). Endpoint deliberately NOT named
/api/documents/upload — the dev machine's antivirus blacklisted that URL
after EICAR tests (see TESTING.md).

## ADR-0017 (2026-07-22) — Auto-advance is one-way and stops at in_progress
Checklist automation (M3) only ever moves an engagement forward and only
out of not_started/awaiting_docs categories: items-exist+required-missing
moves not_started→awaiting_docs; all-required-satisfied moves
not_started/awaiting_docs→first in_progress stage. It never touches
engagements at in_progress or beyond (late-arriving docs must not yank a
return out of review/filing) and never moves backwards. Per ADR-0015 it
keys on stage.category only; if a custom pipeline lacks the target
category, the rule silently no-ops rather than guessing a stage. Audited as
actor_type=system, action `engagements.auto_advance`.

## ADR-0018 (2026-07-22) — Portal magic links: signed JWT + hashed row, deliberate open, 30-min session
The link carries an HS256 JWT (AUTH_SECRET) embedding org_id, client_id,
scopes, and the portal_token row id; the row stores only sha256(raw)
(ADR-0003). Validation verifies the signature FIRST — the signed org claim
is what arms RLS for the hash lookup, so portal_token needs no
GUC-as-credential policy (ADR-0009 pattern not required). Lifecycle: 7-day
TTL unopened; opened_at starts a 15-minute window for the LINK; the 6-digit
SMS OTP (10-min, sha256(code+id), durable 5-attempt lockout in the row) is
sent only on a deliberate "Continue" press — never on GET, because
SMS/messenger apps prefetch URLs and would burn the window and trigger
texts. After verification a signed 30-minute session cookie takes over;
every portal request re-loads the row, so staff revocation kills live
sessions on the next navigation. Anonymous endpoints are rate-limited per
IP and per token via an in-memory fixed-window limiter
(src/lib/rate-limit.ts) — per-process only, fine single-instance; the cap
that must survive restarts (OTP attempts) lives in the row.

## ADR-0019 (2026-07-22) — portal.manage_links: clerk allow, accountant assigned
Issuing/revoking portal links is front-desk work at the customer's firm
(the clerk answers the phone when an elderly client can't find their link),
so clerk = allow — consistent with messages.send_templated, and the link
alone grants nothing without the OTP to the client's own phone. Accountants
get 'assigned' like other client-comms writes (messages.send_custom).
Issue and revoke share one action; both are audited with op details.

## ADR-0020 (2026-07-22) — jscanify/OpenCV.js vendored into public/vendor; CSP extended narrowly
The portal capture flow uses jscanify + its bundled OpenCV.js build
(~8.6 MB). CDNs are blocked by the same-origin CSP (correctly), so a
postinstall script (scripts/copy-vendor.mjs) copies both files from
node_modules into gitignored public/vendor/. CSP additions are the
deliberate minimum per next.config.ts's note: 'wasm-unsafe-eval' in
script-src (OpenCV compiles WASM; plain eval stays blocked in prod) and
worker-src 'self' blob:. Camera failure, load failure, or no detected page
all fall back to the native `<input capture>` camera — the flow never
dead-ends for the elderly audience.
