# Progress

_Last updated: 2026-07-23 (M8 AI suite complete — 172 Vitest / 28 Playwright green)_

## DONE
- **M0 — Foundation** (commit `M0: ...`): scaffold, RLS + OrgScope, better-auth
  with mandatory TOTP, permission matrix + audit, shells, tests, CI, docs.
- **M1 — SaaS shell** (commit `M1: ...`): signup→firm creation, Stripe
  checkout/trial/webhooks/grace mode (flat $300/firm — ADR-0012, live-verified),
  Customer Portal, invitations (outbox email+SMS, hashed tokens), employees
  settings, role dashboards, settings pages.
- **M2 — Client hub** (this commit):
  - Schema + FORCEd RLS: client (SIN AES-256-GCM via crypto.ts + sin_last3
    for mask-only display, custom_fields jsonb, tags[], preferred_channel,
    assigned accountant), household, engagement (7-status pipeline
    ADR-0013, status_timestamps, assignee), client_note (pinned),
    contact_log. Deterministic seed: 10 Lakeside clients (2 households,
    2 encrypted SINs, corp + trust), 9 engagements across every board
    column, notes + contact history, 1 isolation client in org 2.
  - OrgScope methods: listClientsWithMeta (assignee/household names + latest
    engagement + last contact merged), detail (household members, notes,
    contacts, engagements), CRUD, households, notes/pin, contact log,
    engagements (create/transition/assign/countByStatus).
  - Permissions: new `engagements.create` action (accountant=assigned,
    clerk=deny); all mutations via authorize() with resource assignment;
    server actions return denials as friendly messages (tryAuthorize) —
    still audited. Accountant assigned_only view-scoping enforced in grid,
    detail (404, no existence leak), board, dashboards (viewAssignedOnlyFilter).
  - UI: clients grid (TanStack Table — search, type filter, archived toggle,
    sortable, stage badges, owner, last contact), client detail (masked SIN,
    household links, pinned-note callout, notes, contact log, engagement
    transitions + assignment), new/edit forms (SIN validated Luhn +
    encrypted server-side, never echoed), workflow kanban (HTML5 drag,
    optimistic move, permission-locked cards with lock icon, firm/mine
    filter), dashboards wired to real client/engagement counts by stage.
  - Tests: 49 Vitest (12 new in clients.test.ts) + 9 Playwright (4 new in
    m2.spec.ts). e2e TOTP secrets now persist across spec files
    (e2e/.totp-secrets.json, cleared each run); auth rate limit 300/min
    outside production (ADR-0014).

- **Post-M2: customizable workflow stages (ADR-0015, customer request)**:
  engagement_status enum → per-org engagement_stage rows (immutable key,
  label, fixed category, position). Default 7-stage template at org
  bootstrap/seed/backfill. Settings → Workflow stages (owner/admin): rename,
  reorder, add, delete-with-reassign (min 2 stages). Board columns, detail
  transitions, grid badges, dashboard counts all follow org stages; automation
  hooks (M3+) must key on stage.category only. 54 Vitest + 10 Playwright.

- **M3 — Vault & checklists** (this commit):
  - Schema + FORCEd RLS (0011/0012): document (quarantine→vault s3_key,
    status pending_scan/clean/infected/scan_failed, scan_result, source,
    uploaded_by), checklist_item (required, missing/received/waived,
    document link, position).
  - Upload pipeline (ADR-0016): /api/vault/upload route (multipart,
    same-origin check, type allowlist, 25 MB) → org/{orgId}/quarantine/ →
    synchronous ClamAV INSTREAM (src/lib/clamav.ts) → promote to vault
    (CopyObject+Delete) or flag; scan_failed retryable, never treated as
    clean; downloads = 5-min presigned GET, clean docs only, audited.
    src/lib/storage.ts (S3 client, keys, sanitizeFilename, presign);
    CLAMAV_HOST/PORT in env.ts; staffApiContext() (JSON-error variant of
    requireStaff) in context.ts.
  - Checklist engine (src/lib/checklists.ts): per-type templates
    (t1/t2/t3; 'other' starts empty), instantiated on engagement creation +
    on demand ("Generate checklist"); custom items add/remove; manual
    received/waived/missing; auto-advance ADR-0017 (category-keyed, forward
    only, audited as system engagements.auto_advance).
  - UI: client detail Documents card (upload, status badges, download,
    rescan, remove, file-against-engagement) + per-engagement checklist
    panel (per-item upload/got-it/waive/reset/remove, add item); intake
    queue at /app/tax/intake (clerk upload path, manage-gated filing with
    optional checklist slot); Returns page /app/tax (year filter,
    stage + checklist progress + missing-required titles per return,
    missing-docs stat cards).
  - Seed: 6 documents (vault/quarantine/infected/scan_failed states,
    fixture objects actually uploaded to the dev bucket when S3 creds
    present) + 11 checklist items incl. org-2 isolation rows.
  - Tests: 69 Vitest (15 new in documents.test.ts) + 14 Playwright (4 new
    in m3.spec.ts, running against the REAL dev bucket + local clamd).
  - Dev-machine gotcha (documented in TESTING.md): Norton intercepts EICAR
    on localhost HTTP and then blacklists the upload URL (connection resets
    with an empty server log) — endpoint renamed to /api/vault/upload; e2e
    infected-path assertions use a seeded fixture instead of live EICAR.

- **M4 — Client portal** (this commit):
  - Schema + FORCEd RLS (0013/0014): portal_token (token_hash sha256-only
    per ADR-0003, recipient name/phone, trusted-helper fields,
    include_household, scopes[], expires/opened/verified/revoked stamps,
    durable OTP attempt counter). No GUC-as-credential policy needed — the
    magic-link JWT's signed org_id claim arms RLS (ADR-0018).
  - Token service (src/lib/portal-tokens.ts): HS256 JWT mint/validate
    (org_id+client_id+scopes+row id), 7-day unopened / 15-min opened TTLs,
    6-digit SMS OTP (outbox in dev; 10-min window, sha256(code+id), 5 wrong
    entries lock the link durably), timing-safe compare, audited lifecycle
    (link_opened / otp_sent / otp_failed / otp_verified as actor client).
  - Portal session (src/lib/portal-context.ts): signed 30-min cookie set
    after OTP; every request re-loads the token row → revocation kills live
    sessions; household scoping resolves client+members per request.
  - Rate limits (src/lib/rate-limit.ts, in-memory fixed-window): link
    opens + OTP starts per IP, OTP sends per token, verifies per IP,
    uploads per token. Durable cap (OTP attempts) is in the row, not RAM.
  - Staff UI: "Portal access" card on client detail — issue to client or
    trusted helper (name/relationship/phone, optional whole-household),
    status per link (sent/opened/in use/expired/revoked/locked, phone tail
    only), revoke. New action portal.manage_links: owner/admin/clerk allow
    (front desk — ADR-0019), accountant assigned. Link goes out via outbox
    SMS (+email for non-helper when on file); raw link never returned to
    the browser or logged.
  - Portal surfaces (.portal-theme, AAA): /portal/[token] welcome → OTP —
    the GET only validates; a deliberate Continue stamps opened_at and
    sends the code (SMS-app prefetch can't burn the window or text codes);
    three-card home (Send us a document / What we still need / Sign a form
    [M6 placeholder]) with live missing count; plain-language checklist
    ("Still needed"/"We have it"/"Not needed this year", per-person
    grouping for households, "Send it" deep-links into upload).
  - Uploads: /api/portal/upload → same quarantine→ClamAV→vault pipeline
    (ADR-0016) with source=portal_upload, uploaded_by null, actor-client
    audit; token scope decides whose documents; checklist item satisfaction
    + auto-advance identical to staff path; staff Documents card shows a
    "Portal" badge. Friendly outcomes only (received / rejected / held) —
    scanner details never reach the portal.
  - jscanify capture (ADR-0020): camera preview → snap → OpenCV.js paper
    extraction → straightened preview → confirm; vendored to public/vendor
    on postinstall (CDNs stay CSP-blocked); CSP additions kept minimal
    ('wasm-unsafe-eval', worker-src 'self' blob:); every failure falls back
    to the native camera input.
  - Tests: 81 Vitest (12 new in portal.test.ts) + 17 Playwright (3 new in
    m4.spec.ts; axe wcag2a/aa/aaa + best-practice on every portal screen,
    zero violations). Production build verified.

- **M5 — Messaging** (this commit):
  - Schema + FORCEd RLS (0015/0016/0017): message_template (per-org, unique
    name, channel-fixed after creation, archive/restore), message — the
    send log: one row per intended CLIENT recipient (sent/failed/skipped +
    skip_reason, ADR-0022), linked to outbox transport rows;
    client.sms_opt_out_at consent stamp; GUC-as-credential policies
    org_system_sweep + client_by_phone (ADR-0009 pattern); pgboss schema
    owned by crm_app + database CREATE grant (0017).
  - Template engine (src/lib/templates.ts): {client_name}/{first_name}/
    {firm_name}/{tax_year}/{missing_docs}/{accountant_name}, literal
    substitution only, unknown placeholders rejected in the editor and
    reported by previews. 3 seeded defaults per org (bootstrap + seed).
    Settings → Templates (messages.manage_templates): edit-in-place,
    variable chips, archive/restore, + the reminder policy card
    (org.update_settings).
  - Real adapters behind the outbox (env-gated; outbox/console stays the
    dev default): Twilio REST via fetch (15 s timeout), SES via
    @aws-sdk/client-sesv2. Outbox row first (queued), provider flips
    sent/failed + provider_message_id/error. No automatic retries — sends
    aren't idempotent (ADR-0022). EMAIL_MODE=smtp validates but has no
    adapter (falls back to outbox, warned).
  - pg-boss 12 job runner (src/lib/jobs.ts, started once per server in
    src/instrumentation.ts; JOBS_ENABLED=false opts out): document-scan
    (ADR-0021 — upload requests now stop at quarantine; scan/promote/
    checklist/auto-advance in the job; staff UIs poll
    /api/vault/scan-status; portal answers "received" instantly),
    message-send (mass-send transport, batch 10), reminders-sweep
    (singleton; prod cron */5, dev/test interval REMINDER_SWEEP_INTERVAL_MS
    default 5 s — the accelerated clock). Job-less contexts fall back to
    the same job bodies synchronously.
  - Reminders (src/lib/reminders.ts): "awaiting_docs-CATEGORY stage for
    N days + required checklist items missing → nudge exactly those items"
    — category-keyed only (ADR-0015/0017 posture), cadence-deduped via the
    send log, silent skips (no row spam), degrade-to-no-op when the org
    lacks a usable template/channel. Config in org.settings.reminders
    (defaults: disabled/7 d/3 d/preferred — code-side, no backfill).
  - Messaging page (/app/messaging, replaces the placeholder): mass-send
    composer (stage-category/type/missing-docs filters, live preview with
    per-recipient variables, reachability badges) → per-recipient message
    rows + message-send jobs; send log table (statuses, skip reasons,
    "Automatic" for system sends). Clerks may mass-send (matrix unchanged
    since M0).
  - Consent/STOP: Twilio inbound webhook /api/webhooks/twilio
    (X-Twilio-Signature validated, keyword set mirrors Twilio's) flips
    sms_opt_out_at across ALL orgs holding that phone (ADR-0022), audits as
    actor client, and writes the contact timeline. Every SMS path checks
    consent BEFORE any outbox row; staff see a "No texts (STOP)" tag on the
    client. Seed: Hélène Desjardins is opted out.
  - Every send (mass + reminder) lands on the client contact timeline;
    reminders also audit as system messages.reminder_sent.
  - Tests: 98 Vitest (17 new in messaging.test.ts — rendering, channel
    resolution + consent, send-log side effects, sweep w/ cadence, Twilio
    signature math, RLS) + 21 Playwright (4 new in m5.spec.ts, incl. the
    ACCEPTANCE test: a scheduled reminder fires under the accelerated
    clock via the real pg-boss sweep, exactly once, then policy off).
    m3/m4 upload assertions adapted to the async verdict.

- **M6 — E-signature** (this commit):
  - New dependency: **pdf-lib** (ADR-0024) — pure-JS PDF read/stamp, no native
    deps, no rasterizer, no CSP-sensitive worker.
  - Schema + FORCEd RLS (0019/0020): signature_request — single-signer envelope
    (client + source document + optional engagement, draft→sent→viewed→signed/
    declined/canceled, jsonb `placements` as normalised {page,x,y,w,h,kind}
    coords, snapshotted signer, source/signed sha256 hashes, signed via/method/
    ip/token/staff for the audit page). document_source enum gains
    'esign_executed'. OrgScope: create/get/update, listSignatureRequests
    (+ assigned scoping), listPendingSignatureRequestsForClients (portal),
    countOpenSignatureRequests (dashboard).
  - PDF engine (src/lib/pdf.ts): `formatCraTimestamp` (CRA
    `YYYY/MM/DD HH:MM:SS`, org TZ, 24h), `hashBytes`, `readPdfPageSizes`,
    `stampSignature` — embeds the drawn PNG or typed name into every placed
    field (top-left → pdf-lib bottom-left conversion in one place), renders
    date fields with the timestamp, and APPENDS an audit page (signer, method,
    authentication, IP, token/operator, source hash, request id). Never
    mutates the source buffer.
  - Orchestration (src/lib/esign.ts): send (hash source, notify signer via M5
    messaging outbox-first, advance the linked engagement to the first
    awaiting_signature-category stage — forward-only, ADR-0027), execute (stamp
    → store a NEW immutable doc under org/{orgId}/signed/ source
    'esign_executed', mark signed, contact log + audit), view/decline/cancel.
    Shared mark validation/decoding (`signatureMarkSchema`/`decodeSignatureMark`).
  - Permissions: `signatures.view` (all roles; assigned-only accountants scoped
    on list/detail) + `signatures.manage` (owner/admin allow, accountant
    assigned, clerk deny). view is grace-mode allowed.
  - Staff UI: /app/esign dashboard (open vs settled); "Request signature" on
    clean PDF rows of a client's Documents card → /app/esign/[id] draft editor
    (aspect-true page boxes, click-to-place + drag signature/date/initials
    fields, ADR-0025; "View the form" opens the PDF inline) → send remotely or
    "Sign in person now"; in-person signing surface (/app/esign/[id]/sign) with
    the shared SignaturePad (draw or type); status timeline, signed-PDF
    download, per-signature audit summary. Dashboard "Out for signature" card
    wired to the real open count.
  - Portal (AAA, ADR-0026): remote signing lives in the portal session — new
    links mint scopes ['view','upload','sign']; the "Sign a form" card lists
    pending requests; /portal/sign/[id] is a one-action-per-screen flow (read
    the form → draw/type → sign & send, or decline) with big targets. The
    OTP-verified portal token id + IP are the recorded authentication.
  - Seed: a REAL one-page engagement-letter PDF (pdf-lib) for Ruth + a "sent"
    request with placed fields (dashboard/in-person demo) and a draft request
    for Marc.
  - Tests: 112 Vitest (14 new in esign.test.ts — CRA timestamp, hashing,
    stamp + immutability, mark decode, category-advance, execute writes a new
    immutable signed doc, RLS isolation, permission matrix) + 23 Playwright
    (2 new in m6.spec.ts: create→place→send, and the ACCEPTANCE in-person
    draft→sent→signed with an immutable executed PDF in signed/).

- **M7 — CRA authorizations, AFR reconciliation, time & billing (basic),
  reporting** (this commit):
  - Schema + FORCEd RLS (0021/0022): cra_authorization (level 1/2/3, status
    pending/active/expired/revoked, optional expiry_date, notes), time_entry
    (work_date, minutes, description, rate_cents snapshot, invoice_id null =
    unbilled WIP), invoice (per-org number from 1, draft/sent/paid/void,
    lines jsonb snapshot, integer-cents totals, tax label + bps). Org
    settings gain `billing` defaults ($200/h, HST 13% — billingSettings()
    accessor, no backfill).
  - CRA authorizations (ADR-0028): src/lib/authorizations.ts derives the
    EFFECTIVE state (active past expiry counts as expired; 90-day
    "expiring soon" window) and rolls each client up to one verdict
    (active > pending > expired > revoked > none). /app/tax/authorizations
    (placeholder replaced) = coverage dashboard: stat cards + per-client
    table, needs-attention sorted. Records managed on the client detail
    page ("CRA authorization" card: add/edit/status/delete). Dashboard
    "Authorization coverage" card wired to the real uncovered count
    (countClientsWithoutActiveAuthorization — expiry-aware SQL). New
    actions authorizations.view (all roles, grace-allowed) /
    authorizations.manage (accountant assigned, clerk deny).
  - AFR reconciliation (ADR-0029): /app/tax/afr (placeholder replaced) —
    pick client + tax year, paste the CRA slip CSV from the tax software's
    Auto-fill download, compare. src/lib/afr.ts: tolerant parser
    (delimiter auto-detect, header aliases, quoted fields, line warnings) +
    word-boundary slip-family matching (T4 ≠ T4A ≠ T4A(OAS); T5 ≠ T5008)
    against checklist titles then document filenames. Verdicts on_file /
    missing / waived (CRA has it, we marked not-needed) / untracked, with
    one-click "Track on checklist" (documents.manage + auto-advance), plus
    the reverse "on our checklist, not in CRA data" list. Stateless — the
    compare stores nothing, audited as documents.view.
  - Time & billing (ADR-0030): /app/billing (placeholder replaced) —
    record time (client/engagement/date/hours/rate, org-default prefill),
    unbilled-WIP-per-client rollup, one-click invoice of ALL a client's
    unbilled entries (atomic: lines snapshot + max(number)+1 per org +
    entry stamping), invoice list + detail (status marches draft→sent→paid;
    void releases entries back to WIP, snapshot kept), on-demand PDF at
    /api/billing/invoices/[id]/pdf (src/lib/invoice-pdf.ts, pdf-lib per
    ADR-0024 — never stored; audited invoices.view; assigned-only 404).
    Money = integer cents everywhere (src/lib/timebilling.ts). New actions
    invoices.view (all roles, grace-allowed) / invoices.manage /
    time.record (accountant assigned, clerk deny).
  - Reporting: /app/reports (new sidebar entry under Practice) — read-only
    practice rollup: pipeline by stage, client mix + returns by type/year,
    authorization coverage, billing (WIP / outstanding / paid). Scoped
    like every list (assigned-only accountants see their book).
  - Seed: 7 authorizations covering every coverage state (3 covered incl.
    one expiring soon, 1 pending, 1 active-but-expired, 1 revoked, 3 none),
    7 time entries (2 invoiced), 1 sent invoice INV-0001 ($932.25,
    lib-computed), org-2 isolation rows for all three tables (org-2 invoice
    is also #1 — proves per-org numbering).
  - Tests: 150 Vitest (38 new: afr.test.ts parsing/matching,
    authorizations.test.ts derivation/coverage/RLS/matrix,
    timebilling.test.ts money math/invoicing/void/RLS/matrix/PDF) + 26
    Playwright (3 new ACCEPTANCE tests in m7.spec.ts: coverage dashboard
    correct vs seed and moves when a record is added; AFR compare from a
    pasted CSV + track-on-checklist; record time → invoice → PDF serves
    with %PDF bytes). m4's revoke assertion re-scoped to a list item (the
    client page now carries a hidden <option>Revoked</option> in the
    authorization status select). Production build verified.

- **M8 — AI suite** (this commit):
  - New dependency **@anthropic-ai/sdk** (ADR-0031); model `claude-opus-4-8`
    (adaptive thinking). No key in dev/test → the MOCK engine runs the SAME
    read-only tool layer with deterministic scripts, so every scoping/
    redaction test exercises the real data path. `features.realAi` gates.
  - Schema + FORCEd RLS (0023/0024): ai_interaction — one row per AiService
    run (feature enum, prompt, response, tools_used names+counts jsonb,
    model, token counts). OrgScope: createAiInteraction, listAiInteractions,
    listProblemDocuments (quarantine view for the risk rules).
  - Read-only tool registry (src/lib/ai/tools.ts): list_clients,
    get_client_overview, pipeline_summary, missing_documents,
    authorization_coverage, billing_summary. Each declares the view Action
    it needs (checked via can(); self-assigned resource ref so accountants'
    'assigned' rules pass and the tools themselves narrow via
    viewAssignedOnlyFilter). Payloads built field-by-field — sin_encrypted/
    sin_last3/date_of_birth/addresses/raw emails/custom_fields can never
    reach a prompt; staff free text (notes, contact summaries) passes
    scrubFreeText (masks SIN-shaped digit runs). NO write exists in the
    registry — zero write paths proven by table-count snapshot test.
  - AiService (src/lib/ai/service.ts): bounded manual tool-use loop (max 8
    iterations, usage summed) against the Messages API; per-feature entry
    points askAssistant (chat w/ history), draftClientEmail (Subject:/body
    format, parsed), prepareMeetingBrief, narrateFindings. Every run logged
    to ai_interaction + audited as ai.use by the actions. ai_enabled=false
    throws AiDisabledError before any tool/model/log call.
  - Audit risk + optimization (ADR-0032): PURE rule engines in
    src/lib/ai/insights.ts — practice risk (filed-missing-docs,
    filed-waived-docs, no-authorization, authorization-expiring,
    missing-sin, stale-stage >45d, quarantined-document) and operations
    (aged-wip >30d, aged-invoice >30d, no-current-return, reminders-off,
    unreachable-client). AI only NARRATES the findings; the table renders
    the rule output verbatim with rule ids. Stateless (AFR posture).
  - Permissions: new `ai.use` (all four roles allow — answers can only
    contain what the caller's own view scope exposes; NOT grace-allowed).
  - UI: all five /app/ai placeholder pages replaced — assistant (chat with
    suggestion chips), email drafts (pick client → instructions → draft →
    EDIT → explicit "Send via Messaging" via messages.send_custom through
    the M5 layer, or copy; clerk send denied by matrix), meeting prep
    (per-client brief), audit risk + optimization advisor (findings table +
    on-demand AI summary). Every page shows a disabled card when the org's
    ai_enabled toggle (Settings) is off.
  - Tests: 172 Vitest (22 new in ai.test.ts — scrubbing, matrix row, rule
    engines, tool scoping incl. no-existence-leak, redaction sweep across
    every tool, ZERO-write snapshot, mock-engine logging, role-scoped
    snapshot numbers, drafts-don't-send, ai_enabled gate, RLS) + 28
    Playwright (2 new ACCEPTANCE in m8.spec.ts: clerk vs assigned-only
    accountant get different scoped assistant answers; email draft creates
    no message/outbox rows until the explicit send, which lands exactly one
    manual message with the human-edited subject). m4's portal-upload test
    now sets test.setTimeout(120_000) like the other pipeline-heavy tests —
    its default 30 s went marginal as the dev server gained routes; m8's
    draft assertion anchors on "Daycare receipts" (the one Ruth item no
    earlier spec satisfies). Production build verified.

## IN PROGRESS
- Nothing — stopped at the M8 boundary. Next milestone is M9 (hardening +
  generic data import).
- **Flagging Satinder (M6 real-device checks, optional):** the whole flow is
  proven in e2e (in-person draft→sent→signed, immutable executed PDF). The
  remaining human check is REMOTE signing on a real phone through a tunnel:
  issue a portal link to a real handset, open it, and sign a form — the same
  tunnel setup as the M4 run. Not required to close M6 (in-person is fully
  covered); nice-to-have alongside the M7 work. `EMAIL_MODE=ses` + live Twilio
  are already in `.env` from M5.

## KNOWN BUGS / LIMITATIONS
- ~~Scanning is synchronous in the upload request~~ Moved to pg-boss at M5
  (ADR-0021). Portal upload now answers instantly; the infected-file
  outcome reaches STAFF (quarantined + Portal badge), not the client —
  deliberate, documented in the ADR.
- EMAIL_MODE=smtp has no adapter (SES is the real path) — falls back to
  outbox with a warning. Build it only if a customer actually needs SMTP.
- Mass send caps at 500 recipients per batch (composer + action) — fine for
  the target firm size; chunking + a progress surface would come with a
  bigger customer.
- The reminder engine's {missing_docs} uses REQUIRED checklist items only
  (mirrors auto-advance's completeness rule); optional-only gaps never
  nudge. Deliberate — revisit only if Joey asks.
- Reminder sends resolve the client's channel at send time; if a client has
  neither a usable email nor consented SMS the nudge silently no-ops (no
  skip rows from sweeps — ADR-0022). Staff still see gaps via the Returns
  missing-docs view.
- Twilio delivery-status callbacks (delivered/undelivered) aren't wired —
  outbox rows show what the API accepted, not carrier delivery. Twilio's
  console covers forensics until this matters.
- **Email deliverability / SES sandbox (deploy-time, M10).** Verified 2026-07-22:
  real SES send works, but (a) the account is in the SES SANDBOX — it only
  delivers to SES-verified recipients; sending to any other address returns
  MessageRejected, which the send log correctly surfaces as Failed. Request
  SES production access before real client email. (b) The test mail landed
  in Gmail spam because it was sent FROM a gmail.com address (fails gmail's
  DMARC when sent via SES) with no domain authentication. Deploy fix: verify
  the FIRM'S OWN domain in SES (yields DKIM CNAMEs), add SPF
  (`include:amazonses.com`) + DMARC records, send From that domain (never
  gmail.com), optionally a custom MAIL FROM subdomain, then warm up volume.
  Belongs in the M10 deployment runbook.
- KMS_KEY_ID intentionally empty in dev (S3 default encryption); real KMS
  key at production setup.
- Host antivirus (Norton) can blacklist upload URLs after seeing EICAR-like
  content on localhost — see TESTING.md before renaming /api/vault/upload
  or adding AV-test uploads.
- Vault documents have no delete path (7-year retention posture); M9 adds
  the retention/review flow. Quarantined (infected/scan_failed) files are
  deletable via documents.manage.
- Deleting an org cascades DB rows but leaves S3 objects under
  org/{orgId}/ — S3 lifecycle/cleanup lands with the M9 backup/retention
  scripts.
- Google-only accounts still can't enroll TOTP (twoFactor.enable needs a
  password). Candidate fix in a later milestone: better-auth setPassword
  path for OAuth-only accounts.
- Multi-org users still land in their first org (switcher deferred).
- checkout.session.completed relies on client_reference_id; sessions created
  outside the app are ignored by design.
- Clients grid filters/search run client-side on the org's full (scoped)
  list — fine at small-firm scale; move search server-side if a firm's list
  grows past a few thousand.
- Households are created inline from the client form; there's no dedicated
  household management page (rename/merge) yet.
- Portal rate limiter is in-memory per process (fine single-instance; moves
  to Postgres/Redis if we ever run multiple app instances). The OTP
  attempt cap is durable in portal_token either way.
- Portal sessions are a fixed 30 minutes with no renew — an unhurried
  upload session that runs long just re-opens the link. Revisit if Joey's
  clients report getting bumped mid-task.
- The magic-link JWT puts ~300 chars in the SMS URL; fine via outbox/Twilio
  segments, but a shortener-style compact token is an easy M5+ tweak if
  carriers mangle long links in practice.
- ~~Portal "Sign a form" card is a static placeholder until M6.~~ DONE (M6):
  lists pending requests and drives remote signing in the portal session.
- **E-sign field placement is on aspect-true page boxes, not a pixel-rendered
  PDF (ADR-0025).** Adequate for the one/two-page CRA forms this firm signs; a
  pixel-accurate drag-on-the-rendered-page overlay (pdf.js) is M10 polish. The
  actual PDF opens in a tab for reference alongside the placement boxes.
- **Signature reminders are manual** (staff re-open a sent request; there's no
  automated "you haven't signed yet" sweep like the M5 doc reminders). Add a
  category/age-keyed signing-reminder sweep if Joey asks — the plumbing
  (message layer, awaiting_signature category) is already there.
- **Executed PDFs have no delete path** (same 7-year retention posture as vault
  docs) — deliberate; the M9 retention flow covers review/removal.
- **Invoicing bills ALL of a client's unbilled time** (no per-entry
  cherry-picking) and there's no invoice-edit surface — void and re-record
  is the correction path. Deliberate basic scope (ADR-0030); extend when a
  customer asks.
- **No billing-settings UI**: the org's default hourly rate / tax rate+label
  are code-side defaults (org.settings.billing, billingSettings()); both are
  editable per entry / applied per invoice. A Settings card is trivial to
  add when Joey wants firm-specific defaults.
- **AFR matching covers the common slip families** (T4 group, T5 group, T3,
  T2202, RRSP, RC62); unknown slip types fall back to a literal token match
  and land as "untracked" at worst — never silently dropped.
- Seed authorization expiries are fixed dates (Hélène 2026-09-15, Blackwood
  2026-01-31), same convention as the portal-token fixture dates: the seeded
  "expiring soon" badge reads correctly while the dev clock sits in the 2026
  season; unit tests pin `today` explicitly.
- **Clerk (front-desk) dashboard is the personal/assigned-to-me variant, which
  reads mostly zero for clerks** (nothing is ever assigned to a clerk).
  Customer-noted 2026-07-22; logged for M10 polish. Their actual workflow
  (all-clients list, document intake queue, portal links, messaging) works
  via the sidebar — only the /app landing page isn't tailored. M10 build: a
  front-desk dashboard (documents in intake, firm-wide clients awaiting docs,
  recent portal activity).
- **Dashboard "Documents outstanding" card is a stale pre-M3 placeholder**
  (shows "—" + "Arrives in M3" though M3 shipped). Customer-noted
  2026-07-22. M10 fix: wire it to the real missing-required-docs count
  (listChecklistSummaries / listMissingChecklistItems already exist), scoped
  firm-wide vs assigned like the rest of the dashboard, linking to the
  Returns page. The M6 (signatures) and M7 (authorizations) cards beside it
  are correctly still upcoming.
- **Page detection quality is "good enough", deferred to M10 polish**
  (customer decision 2026-07-22, after the real-device run). jscanify's
  single Canny+Otsu pass misses low-contrast scenes — white paper on a pale
  counter, or a page with no margin in frame. Mitigated for now by the live
  outline + guidance copy, a quality gate that refuses implausible quads,
  and an honest fallback to the unmodified photo (always acceptable to
  send). Candidate improvements when we polish: drag-to-adjust corners
  (extractPaper already accepts custom cornerPoints), auto-capture once a
  stable quad holds for N frames, a multi-strategy detector (adaptive
  threshold + approxPolyDP fallback behind Canny), a torch toggle for low
  light, and client-side downscale before upload.
- Portal upload round trip measured at ~7.7 s for a 189 KB phone photo
  through a tunnel (app-proxied multipart + synchronous ClamAV scan,
  ADR-0016). Fine at this size; the M5 pg-boss move takes scanning out of
  the request and should cut the client-visible wait.

## NEEDS SATINDER'S / JOEY'S REVIEW
- ~~ADR-0004 accountant_scope_mode default~~ RESOLVED 2026-07-22 (Satinder):
  accountants see ONLY assigned clients → default becomes `assigned_only`.
  Code change is a pre-M6 follow-up (see ADR-0004 + IN PROGRESS).
- ~~M4 manual verification~~ DONE 2026-07-22 with Satinder over a
  Cloudflare tunnel on a real handset (TESTING.md "Manual checklist — M4").
  Capture-detection tuning consciously deferred to M10.
- ~~ADR-0019: clerks issue/revoke portal links~~ CONFIRMED 2026-07-22
  (Satinder, ADR-0023): front desk sees all clients, issues portal links,
  AND mass-sends templated SMS/email. No code change — blesses the matrix.
- ~~ADR-0013 stage names~~ RESOLVED by ADR-0015: stages are per-org editable
  (Settings → Workflow stages); Joey tunes his own template.

## M5 REAL-PROVIDER VERIFICATION (2026-07-22, with Satinder)
- Twilio SMS: LIVE — real text delivered to a handset through the product
  path (template → message row → outbox → Twilio SID SMe765af1…). Account is
  full (not trial). "Real SMS with keys" acceptance bar MET.
- SES email: LIVE — real email delivered via SES (msg id 010d019f8c85b690…);
  IAM `ses-send` inline policy on accountant-crm-dev-app, gmail identity
  verified, EMAIL_MODE=ses. Still in the SES sandbox (verified recipients
  only) — request production access before real client email.
- STOP/START: webhook proven via a locally-signed simulated inbound POST
  (scripts/simulate-inbound-sms.ts — deleted after); real text-STOP needs a
  public tunnel (Twilio → webhook) and is a later manual step.
- Test-only leftover: a real phone number sits on Ruth Okafor's seed record
  for these tests — REVERT (reseed or set back to +14165550105) before M6.

## M3 PREREQUISITES (done 2026-07-21 with Satinder)
- Dev S3 bucket `accountant-crm-dev` (ca-central-1, versioned, private);
  IAM user `accountant-crm-dev-app`; keys in .env. KMS deferred to prod.
- Docker Desktop (Windows 11 Home / WSL2); crm-clamav container healthy,
  verified 2026-07-22 (PING/clean/EICAR over INSTREAM).
- AWS budget alarm skipped for now (new account on free credits with
  automatic credit-exhaustion notifications).

## NEXT 3 CONCRETE STEPS (M9 — hardening + generic data import)
1. Security hardening pass per the spec's §6 checklist with evidence
   recorded in TESTING.md: dependency audit (pnpm audit + review),
   tenancy-isolation red-team tests (deliberate cross-org probes through
   every surface incl. the AI tools), backup script, retention/review job
   (vault + executed PDFs have no delete path by design — M9 builds the
   7-year retention flow), S3 lifecycle/cleanup for deleted orgs.
2. Generic import wizard: messy-CSV column mapping onto client/custom
   fields (import_batch, import_mapping_template, staging tables per
   DATA_MODEL "Planned"), warnings surfaced, rollback restores clean state.
3. Bulk document importer.

M8 leftovers worth knowing: the real-model path (ANTHROPIC_API_KEY set) is
built but unverified against the live API — first run with a key should
sanity-check tool_use round-trips + the Subject:-format contract on the
email drafter (mock and prompts agree on it; ADR-0031). The AI usage log
has no staff-facing viewer yet (audit page candidate, M10 polish).
