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

## ADR-0004 (2026-07-21; RESOLVED 2026-07-22) — accountant_scope_mode default
Spec left the default open ("confirm with customer"). **Customer decision
(Satinder, 2026-07-22): accountants see ONLY their assigned clients** — the
default is `assigned_only`, not `all_read`. `all_read` stays available as the
per-org setting for firms that prefer shared visibility. Implementation
(pre-M6 follow-up): flip `defaultOrgSettings.accountant_scope_mode`, the
org-settings column default, and the seed so Lakeside runs assigned-only;
adjust any e2e that assumed an accountant sees the whole book. The
permission layer + `viewAssignedOnlyFilter` already enforce the mode — only
the default changes.

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

## ADR-0021 (2026-07-22) — Document scanning moved to pg-boss; portal answers before the verdict
Revises the synchronous-scan half of ADR-0016 (which explicitly deferred
this to M5). Upload routes now stop at quarantine: bytes → S3 → a
`document-scan` job (retryLimit 3) scans, promotes/flags, then satisfies
the checklist slot + auto-advance on a clean verdict. Staff UIs poll
/api/vault/scan-status briefly so the uploader still sees the verdict; the
PORTAL responds "received" immediately — elderly clients should not watch a
spinner for a scanner (M4 measured ~7.7 s through a tunnel), and a file
flagged later stays quarantined and surfaces to STAFF, who follow up.
scan_failed still throws inside the job so pg-boss retries scanner blips;
the row is never treated as clean. When the runner is off
(JOBS_ENABLED=false, unit tests) routes fall back to the same job body
synchronously — one code path, two schedules. The runner itself starts in
instrumentation.ts (once per Next server instance): one process to operate,
which fits a small-firm deployment; the pgboss schema is owned by crm_app
(0016/0017) so its internal DDL needs no superuser.

## ADR-0022 (2026-07-22) — Messaging: message rows for every recipient; sends never retry
The send log (`message`) records one row per intended CLIENT recipient —
sent, failed, or skipped(sms_opt_out | no_address) — so a mass batch always
accounts for everyone; transport rows stay in `outbox` (M1) and link back.
Provider sends are NOT retried automatically (Twilio/SES creates aren't
idempotent; a duplicate "reminder" to an elderly client is worse than a
failed row a human can resend), so message-send jobs run retryLimit 0 and
deliverQueuedMessage marks failures instead of throwing. Reminder sweeps
create NO skip rows (they re-evaluate every few seconds — rows would spam
the log); mass sends DO (a human asked for that exact list). SMS consent
lives on the client row (sms_opt_out_at), is enforced at the client-send
layer (raw sendSms still serves portal OTPs and staff invites — Twilio
blocks carrier-level STOPs regardless), and is mirrored from Twilio's
inbound webhook, which matches the phone across ALL orgs (a client of two
firms who texts STOP opts out of both — the safer reading; policy
client_by_phone, SELECT-only). Reminder policy config hangs off
org.settings.reminders with code-side defaults (disabled; 7 days; cadence
3) — no backfill needed, pre-M5 orgs simply read defaults.

## ADR-0023 (2026-07-22) — Clerk (front desk) may see all clients + send client messages
Customer decision (Satinder, 2026-07-22), confirming the M4/M5 posture:
front-desk/clerk accounts legitimately need to see the whole client book and
reach clients — issue/revoke portal links for sign-up + doc upload
(confirms ADR-0019) AND mass-send templated SMS/email from the dashboard
(messages.send_templated, already clerk=allow in the matrix). Rationale: the
clerk is who answers the phone and chases documents; the link alone grants
nothing without the client's own OTP, and sends are template-based + logged
+ consent-aware (STOP). Contrast ADR-0004: this WIDENS clerk visibility to
all clients while NARROWING accountants to assigned-only — different roles,
different jobs. No matrix change needed; this blesses the existing rules.

## ADR-0024 (2026-07-22) — pdf-lib for signature stamping (new dependency)
M6 needs to read a PDF's page geometry and write a signature image + a CRA
timestamp + an appended audit page onto it, then emit a new file. The stack
list (CLAUDE.md) named no PDF library, so per the iron rule this ADR records
the choice: **pdf-lib** — pure TypeScript, zero native deps, runs in the Node
server runtime (no rasterizer, no headless browser, no CSP-sensitive worker),
and only ever APPENDS/overlays (it never rewrites the source object). Standard
fonts only (Helvetica / Times-Italic for typed signatures), so no fontkit and
no embedded-font licensing. Rejected: pdfkit (generate-only, can't load an
existing form), HummusJS/muhammara (native build), server-side rasterizers
(no headless Chrome in this deployment). The one thing pdf-lib does NOT give
us is client-side visual rendering of the PDF for the placement UI — see
ADR-0025 for how placement avoids needing it.

## ADR-0025 (2026-07-22) — Field placement on aspect-true page boxes; no in-browser PDF renderer
The T183-style placement UI lets staff drop signature/date fields onto the
PDF. Rendering PDF *pixels* in the browser would mean pdf.js — a heavy
dependency with a worker + eval/CSP friction (we already narrowly extended CSP
for OpenCV, ADR-0020, and don't want to widen it again). Instead: the server
reads each page's real dimensions with pdf-lib and the placement editor draws
an **aspect-ratio-accurate page box** per page; staff click/drag to place
fields, stored as NORMALISED coordinates ({page, xPct, yPct, wPct, hPct},
top-left origin) that survive any later scaling and convert cleanly to
pdf-lib's bottom-left origin at stamp time. The actual PDF is shown alongside
in a native `<object>` viewer (inline presigned GET) for reference. This is
dependency-light, CSP-safe, fully unit-testable (coordinates are pure math),
and adequate for the standard one/two-page CRA forms this firm signs. A
pixel-accurate drag-on-the-rendered-page overlay is logged as M10 polish.

## ADR-0026 (2026-07-22) — Remote signing reuses the portal session + a 'sign' scope; no signing-token table
Signing-token infra would duplicate portal-tokens.ts. Instead remote signing
lives INSIDE the existing portal session (ADR-0018): the client opens their
magic link, clears the SMS OTP, and the "Sign a form" card lists their pending
requests. A request is signable only when the session token carries the 'sign'
scope AND the request's client is inside the token's client/household scope —
exactly the check portal uploads already do. New portal links therefore mint
scopes ['view','upload','sign'] by default (the link already grants full
document read/upload to the same person behind the same OTP — signing is
within that trust boundary); pre-M6 links without 'sign' simply show a "your
accountant will send you a new link" note. The OTP-verified portal token id +
IP are recorded on the signature as the authentication event. In-person
signing skips all of this: it happens in the authenticated STAFF session on
the firm's own device, and records the operating staff user + IP + method.

## ADR-0027 (2026-07-22) — Executed PDF is a new immutable object; sending advances the engagement by category
The source PDF is never mutated or overwritten (iron rule + 7-year retention
posture): stamping produces a NEW object at org/{orgId}/signed/{docId}/ and a
NEW document row with source 'esign_executed', status 'clean' (we generated it
from a vault-clean source + an embedded PNG; it never touches the ClamAV
pipeline). It inherits the vault's no-delete stance, so the executed record is
immutable end-to-end. Notifications go through the M5 client-messaging layer
(outbox-first, consent-aware). "Out for signature" is driven two ways that
agree: the e-sign page lists signature_requests by their own status
(draft/sent/viewed/signed/declined), and — because automations may key only on
stage CATEGORY (ADR-0015/0017) — SENDING a request also advances any linked
engagement FORWARD to the first awaiting_signature-category stage (forward-only,
no-op if the pipeline has no such category or the engagement is already at/past
it, audited actor_type=system action esign.stage_advanced). Signing does NOT
auto-transition further; staff move to filed themselves (ADR-0013's manual
any→any stance holds).
