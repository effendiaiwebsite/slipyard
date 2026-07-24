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

## ADR-0028 (2026-07-23) — CRA authorizations: recorded status + derived expiry, one coverage verdict per client
The CRM tracks the firm's CRA representation paperwork (T1013/AuthRep for
individuals, RC59-style for businesses) BESIDE the EFILE software — it never
talks to the CRA, so rows record what staff know: level (1 view / 2 view+
change / 3 delegate), status (pending/active/expired/revoked), optional
expiry (CRA authorizations don't expire unless the client set a date), notes.
Two derivations, both in src/lib/authorizations.ts and mirrored in SQL for
the dashboard count: an 'active' row past its expiry_date COUNTS AS expired
without anyone editing it (staleness must not look like coverage), and a
client's rows roll up to one verdict — active > pending > expired > revoked >
none — with a 90-day "expiring soon" flag on active coverage. Records are
managed on the client detail page; /app/tax/authorizations is the read-only
coverage dashboard (needs-attention sorted). Rows may be deleted only to fix
data-entry mistakes (audited); real lifecycle changes are status edits, so
history stays reconstructable from the audit log.

## ADR-0029 (2026-07-23) — AFR reconciliation: pasted CSV, stateless compare, word-boundary slip matching
The firm's tax software downloads the CRA's slip list (Auto-fill My Return);
the CRM can't (no CRA integration by design), so the bridge is a pasted CSV
(/app/tax/afr). Parsing (src/lib/afr.ts) is tolerant — delimiter auto-detect
(comma/semicolon/tab), header aliases (slip/type/form, issuer/payer/employer,
amount/total), quoted fields, per-line warnings — because every tax package
exports slightly differently. The compare is STATELESS: nothing is imported
or stored (slip amounts can embed income data; we surface, staff act), and
the run is audited as a documents.view with row counts only. Matching keys on
word-boundary slip-family tokens (T4 ≠ T4A ≠ T4A(OAS) ≠ T4RSP; T5 ≠ T5008)
against checklist item titles first, then document filenames. Verdicts:
on_file (received item or filename match), missing (tracked, not received),
waived (marked not-needed yet the CRA has it — surfaced loudly), untracked
(nothing covers it, with a one-click "track on checklist" that creates a
required item via the normal documents.manage path + auto-advance). A
reverse list shows slip-shaped checklist items absent from the CRA data as
"double-check", not errors — slips reach the CRA late.

## ADR-0030 (2026-07-23) — Time & billing: integer cents, snapshot lines, per-org numbering, on-demand PDF
All money is integer CENTS (CAD); rates are per-hour snapshots on each time
entry (org default from settings.billing, editable per entry); rounding
happens once per entry (minutes × rate) and once for tax (on the subtotal,
org-default rate/label per invoice). Invoicing takes ALL of a client's
unbilled entries (cherry-picking is deferred until a customer asks),
snapshots them into the invoice's `lines` jsonb, assigns max(number)+1
per org atomically, and stamps entry.invoice_id — so editing/deleting
entries never changes an issued invoice, unbilled WIP is simply
invoice_id IS NULL, and invoice numbers are gapless per firm. Statuses
draft→sent→paid, or void (draft/sent only); voiding clears its entries'
invoice_id (work returns to WIP) but keeps the lines snapshot for the
record. The PDF (src/lib/invoice-pdf.ts, pdf-lib per ADR-0024) renders on
demand from the row via an audited staff-session route and is never stored —
the row is authoritative and the bytes are reproducible, so retaining
another S3 object would only create a second source of truth. Invoiced time
entries are immutable (delete refuses them); paid invoices are terminal.

## ADR-0031 (2026-07-22) — M8 AI suite: @anthropic-ai/sdk, read-only tool layer, mock without key
New dependency (stack list named "Anthropic API behind AiService" but no
client): **@anthropic-ai/sdk** — the official SDK; model `claude-opus-4-8`
(adaptive thinking, no sampling params). Architecture:
- **One service, two engines** (src/lib/ai/service.ts): with
  ANTHROPIC_API_KEY the SDK's beta tool runner drives the loop; without it
  (dev/test default) a deterministic MOCK engine runs the SAME tool layer
  with a scripted tool sequence per feature and renders the results as text.
  Scoping/redaction therefore live in the tools, not the engine — every test
  of the mock path exercises the exact data path the real model uses.
- **Read-only tool registry** (src/lib/ai/tools.ts): each tool declares the
  view Action it requires (checked via can()) and receives ONLY an OrgScope +
  the caller's role context; list-shaped tools apply viewAssignedOnlyFilter.
  Tools build their payloads field-by-field (never spread a row), so
  sin_encrypted/sin_last3/date_of_birth can never reach a prompt — the iron
  rule "no SIN/full DOB to model APIs" is enforced structurally and by test.
  The registry exposes no create/update/delete of any kind: AI cannot write
  records because no write exists to call (zero-write proven by test).
- **Every run is logged** to `ai_interaction` (feature, prompt, response,
  tools used + row counts, model, token usage; RLS FORCEd) and audited as
  `ai.use`. New permission action `ai.use`: allow for all four roles (the
  assistant answers only what the caller's own view permissions expose), NOT
  grace-mode-allowed (lapsed orgs keep their data, not the AI convenience).
  Per-org kill switch = existing org.settings.ai_enabled; the service throws
  before any model/tool call when it's off.
- **Drafts only**: the service returns text. Nothing it returns is sent,
  saved to client records, or classified anywhere. The ONE bridge into the
  world — "Send via Messaging" on the email-drafts page — is a separate
  staff-triggered server action authorized as messages.send_custom
  (accountant assigned, clerk DENY) that routes the (possibly edited) draft
  through the M5 client-messaging layer as a kind='manual' message with
  consent + channel resolution. The AI path and the send path share no code.

## ADR-0032 (2026-07-22) — Audit risk & optimization: deterministic rules, AI narrates only
Audit-risk and optimization findings are produced by PURE deterministic
rules (src/lib/ai/insights.ts) over practice data the CRM actually holds —
this product sits beside the EFILE software and has no return amounts, so
"audit risk" here means PRACTICE risk: filed/complete returns with missing
or waived required checklist items, filings without an active CRA
authorization (expiry-aware, ADR-0028), unresolved infected/scan_failed
documents, stale in-progress engagements, individuals missing SIN on file.
Optimization advises on operations: aged unbilled WIP, sent-unpaid
invoices, clients with no current-season engagement, reminder policy off
while awaiting_docs piles up, unreachable clients (no email + no consented
SMS). The AI's only job on these pages is to NARRATE the rule output
(sorted, capped, with rule ids) — it never decides what is risky, so
identical data yields identical findings with or without a model key, and
the rules are unit-tested as plain functions. Findings render with their
rule id beside the narrative; nothing is stored on the client record
(same stateless posture as AFR, ADR-0029).

## ADR-0033 (2026-07-23) — Generic import: staged batches, SIN-safe staging, dependency-guarded rollback
The import wizard bulk-loads a messy client CSV onto client rows + per-firm
custom_fields (DATA_MODEL "Planned": import_batch / import_staging_row /
import_mapping_template, all FORCEd RLS — drizzle/0025+0026). The pipeline is
pure→persisted→committed: parseCsv (a full state-machine parser handling
quoted newlines/delimiters) → suggestMapping (header aliases; unmatched
columns become custom:<header>, never silently dropped) → buildStagedRows
(per-field normalise + per-row warnings: invalid email/SIN/DOB, unknown
type/channel/province, nameless rows skipped). A batch is BOTH the unit of
work and the unit of rollback.
- **SIN never persists as plaintext** (iron rule). buildStagedRows is the only
  place the SIN plaintext is touched: it is Luhn-checked and AES-256-GCM
  encrypted there, so the staged `mapped` carries only ciphertext + last-3
  mask and the `raw` snapshot masks that cell. Re-mapping re-stages from the
  client-held CSV (old staging discarded), so no plaintext ever reaches the
  DB, logs, or the browser preview.
- **Commit is atomic**: one transaction creates a client per 'create' row
  (ciphertext copied straight over), resolves any assigned-accountant email to
  a staff id (a no-match becomes a per-row warning + unassigned), stamps
  created_client_id, marks the batch committed.
- **Rollback is dependency-guarded** (the chosen default): it hard-deletes
  exactly the clients the batch created that are still UNTOUCHED; a client
  that has since gained an engagement/document/note/contact/message/auth/time/
  invoice/signature/portal-token is KEPT and reported, and the batch lands as
  'partially_rolled_back'. No other org data is affected. (The alternative —
  cascade-delete everything the batch made regardless of later work — was
  rejected as too destructive for an undo.)
- **Permission**: new `import.manage` — owner/admin ALLOW, accountant/clerk
  DENY, NOT grace-allowed. A firm-wide bulk load that touches SIN is a
  manager-level operation; clerks already can't export SIN-bearing data and
  accountants create clients one at a time. (Default chosen when the operator
  left the scoping question unanswered; revisit if a firm wants accountants to
  self-serve imports.)

## ADR-0034 (2026-07-23) — Retention is review-only; backups + S3 lifecycle are the delete story
Canadian practice keeps client records seven years. The product's posture is
DELETE-FREE by design (ADR-0016/0027: vault docs + executed PDFs have no
delete path), so the "retention flow" is not a purge job — it is a REVIEW
surface (src/lib/retention.ts + /app/settings/retention) listing clean
documents created on/before the 7-year horizon so an owner/admin can act
deliberately and on the record. Disposal, if it ever happens, stays a manual
audited act — never automatic. Two independent safety nets sit beside it:
- `scripts/backup.ts` — pg_dump custom-format (-Fc) to ./backups/, optional
  upload to s3://{bucket}/backups/{db}/ (same ca-central-1 + KMS posture as the
  vault). `--dry-run` verifies pg_dump reachability and prints a
  credential-redacted plan; `PG_DUMP` overrides the binary path. Production
  schedules it; the script is the portable, reviewable core. Verified locally
  against the dev DB (0.29 MB dump, PostgreSQL 17).
- `scripts/cleanup-orphaned-s3.ts` — the ONE cleanup path. Deleting a firm
  cascades its Postgres rows but leaves org/{orgId}/ objects in S3; this sweep
  diffs the bucket's org prefixes against live orgs and removes objects only
  under prefixes whose org no longer exists. Dry-run by default; --apply to
  delete. It can never touch a live tenant's data.

## ADR-0035 (2026-07-23) — Bulk document importer reuses the intake pipeline
The bulk document importer (/app/documents/bulk) is many-files-to-one-client
drag/drop, and it adds NO new server surface: each file POSTs to the existing
/api/vault/upload (quarantine → ClamAV → vault, ADR-0016/0021), so the scan,
storage, and permission rules are byte-identical to a single intake upload.
Permission is therefore `documents.intake_upload` (clerks included — bulk
intake is front-desk work), NOT import.manage; filing to a return still
happens afterward under documents.manage on the intake queue / client page.
The client component caps concurrency (3) and shows per-file status by polling
/api/vault/scan-status, exactly as the single-file intake form does. (The
alternative manifest-CSV mapping of filenames→clients was deferred — the
drop-to-one-client flow is the smallest correct build and covers the firm's
migration need; add a manifest mode if a customer asks.)

## ADR-0036 (2026-07-23) — AI usage viewer is gated by audit.view; front-desk dashboard is firm-wide
Two M10 polish decisions:
- **AI usage log viewer** (/app/settings/ai-usage) lists every ai_interaction
  row — asker, feature, tools used (names + result counts only), model, token
  counts, and the full prompt/response for spot review. It is gated by the
  EXISTING `audit.view` action (owner/admin) rather than a new permission: the
  page is an audit surface (PROGRESS called it the "audit page candidate"),
  prompts may quote scrubbed client context that accountants/clerks outside a
  client's scope should not browse firm-wide, and reusing the action keeps the
  matrix at M9's shape. Revisit only if Joey wants accountants to see their
  own runs (listAiInteractions already supports a userId filter).
- **Front-desk (clerk) dashboard** replaces the personal variant for clerks,
  which read as zeros (nothing is ever assigned to a clerk — customer-noted
  2026-07-22). It is deliberately FIRM-WIDE: intake queue, documents
  outstanding, awaiting-docs count, recent portal uploads — matching ADR-0023
  (front desk sees all clients, issues portal links, mass-sends). No new data
  authority: every number comes from reads the clerk role could already reach
  via the sidebar. The "Documents outstanding" card (all variants) now shows
  countMissingRequiredDocuments — missing REQUIRED checklist items (the same
  completeness rule auto-advance and reminders use), scoped to the assignee on
  the accountant's personal variant.

## ADR-0037 (2026-07-23) — Pixel-accurate e-sign placement: pdf.js paints the M6 boxes
The M6 placement editor kept its whole geometry model (ADR-0025: fractional
top-left coords on aspect-true page boxes; pdf-lib converts at stamp time).
M10 adds pdfjs-dist rendering the REAL page into each box's background
canvas, so what staff see while dragging is the actual form — pixel-accurate
placement without touching the data shape, the stamp path, or the tests.
Decisions inside that:
- The render is COSMETIC and optional: pointer events stay on the box, and
  any failure (fetch, worker, parse) leaves the M6 blank boxes — the editor
  never blocks on pdf.js.
- Bytes come from a new same-origin route /api/esign/[id]/source (staff
  session, signatures.view with assignment scoping, audited, clean-docs
  only) because fetch()ing a presigned S3 URL would require opening the
  bucket's CORS to the app origin — a bucket-config dependency the presigned
  "View the form" tab-open never had. Same-origin keeps CSP connect-src at
  'self'.
- The pdf.js worker is copied to /public/vendor on postinstall (same
  mechanism as jscanify/OpenCV, §6 no-CDN posture); the main library is
  Next-bundled. No CSP additions were needed.

## ADR-0038 (2026-07-23) — Google sign-in does NOT implicitly link to password accounts
Customer report: signing in with Google on an email that already has a
password account errors instead of linking. Root cause of the "why not just
link": better-auth 1.3's two-factor challenge hooks only
`/sign-in/email|username|phone-number` — a social OAuth callback creates a
FULL session with no TOTP prompt, and requireStaff checks enrollment
(user.twoFactorEnabled), not per-session verification. Implicit linking
would therefore let a Google sign-in bypass mandatory TOTP on any linked
account. Per the conflict rule (CLAUDE.md), the safer option wins:
- Implicit linking stays OFF (better-auth default behavior for unverified
  local emails; we deliberately do not add trustedProviders /
  requireLocalEmailVerified overrides).
- The login page now branches on the machine-readable ?error= code
  (errorCallbackURL is plain /login; redirectOnError appends the code):
  `account_not_linked` gets a precise explanation pointing at password +
  authenticator + the new forgot-password link; other codes keep the
  generic invite-or-create message.
Revisit only with a mechanism that challenges TOTP on OAuth sessions
(better-auth upgrade or a custom callback hook), recorded as the acceptance
bar for turning linking on.

## ADR-0039 (2026-07-23) — Self-serve password reset + admin-driven 2FA reset
The lockout story (customer hit it live) is now: (1) "Forgot password?" —
better-auth requestPasswordReset/resetPassword with sendResetPassword
delivering through the org outbox (dev: link surfaces via `pnpm outbox`;
pre-org accounts fall back to direct SES/console since no org outbox
exists), revokeSessionsOnPasswordReset on; (2) lost authenticator —
Settings → Employees "Reset 2FA" (employees.manage, audited op reset_mfa):
clears auth_two_factor + the user flag and revokes sessions via
src/lib/staff-recovery.ts, forcing clean re-enrollment at next sign-in.
Guards: never your own account, owner targets only by an owner (mirrors
changeMemberRole). staff-recovery uses the raw db handle DELIBERATELY —
auth tables are global/non-org-scoped by design (ARCHITECTURE.md), so the
OrgScope iron rule doesn't apply; callers must authorize + verify org
membership first. The dev script (pnpm reset:login) remains the last-resort
path for a locked-out solo owner. Self-serve MFA reset via email link was
REJECTED: it would reduce two-factor to email possession.

## ADR-0040 (2026-07-24) — Bulk client distribution: workload-aware, household-preserving, owner/admin only
The clients list gets a multi-select bulk action that shares a chosen set of
clients across chosen accountants. Split rule (planDistribution, src/lib/
distribution.ts — pure, no DB): collapse the selection into indivisible units
(one per household, one per household-less client), then greedily place the
largest unit onto the accountant with the smallest PROJECTED book, where
"projected" seeds from each accountant's EXISTING load — so the tool levels
whole books, not just the batch (Longest-Processing-Time scheduling).
Deterministic (id tie-breaks) so the preview matches the commit and tests are
stable. Households are kept together (a family / related entities shouldn't be
split across preparers), accepting slightly less exact client-count parity.
Baseline load EXCLUDES the clients being redistributed so they aren't double
-counted. AuthZ: no new matrix action — it authorizes clients.update with NO
specific assignee, which the accountant 'assigned' rule can't satisfy, so it
is owner/admin only (same manager tier as import.manage); audited as
op:distribute. The write is bulkAssignClients (one org-scoped transaction).
REJECTED alternatives: plain even split of only the selection (ignores
standing imbalance); a dedicated permission action (redundant with the
no-assignee clients.update check); reassigning UNSELECTED household members to
follow their household (surprising — only touch what was selected).
