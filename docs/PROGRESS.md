# Progress

_Last updated: 2026-07-23 (M10 polish + deploy complete — ALL MILESTONES DONE;
209 Vitest / 36 Playwright green)_

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

- **M9 — Hardening + generic data import** (this commit):
  - Schema + FORCEd RLS (0025/0026): import_batch (kind/status/filename/
    source_columns/mapping snapshot/counts), import_staging_row (raw cells
    with the SIN cell MASKED, mapped projection carrying SIN as
    ciphertext+last3 only, per-row warnings, action create/skip,
    created_client_id set-null FK), import_mapping_template (unique name per
    org). RLS verified enabled+forced with tenant policies.
  - Import core (src/lib/imports.ts, ADR-0033): full state-machine CSV parser
    (quoted newlines/commas, BOM, delimiter auto-detect); target-field
    registry with header aliases; suggestMapping (unknown headers →
    custom:<header>, never dropped); buildStagedRows — per-field normalise
    (type/channel synonyms, E.164 phone, postal format, DOB formats w/
    ambiguity note, tags split) + per-row warnings; THE ONLY place SIN
    plaintext exists: Luhn-check → encryptField immediately; nameless rows
    skip. SAMPLE_IMPORT_CSV is the deliberately-messy fixture the wizard's
    "Load sample" and the e2e use.
  - OrgScope: createStagedImportBatch, get/list batches, listStagingRows,
    deleteStagedImportBatch, commitImportBatch (atomic; resolves
    assigned-accountant emails to active members, no-match → warning +
    unassigned), rollbackImportBatch (dependency-guarded: deletes only
    created clients with NO dependents across 10 referencing tables; touched
    ones kept + reported → partially_rolled_back), mapping-template
    upsert/list/delete, listRetentionReviewDocuments/countRetentionDocuments.
  - Permissions: new `import.manage` — owner/admin allow, accountant/clerk
    deny, NOT grace-allowed (ADR-0033; default chosen when the scoping
    question went unanswered). All wizard mutations audited
    (import_stage/commit/rollback ops in details).
  - UI: Settings → Data import (4-step wizard: upload/paste w/ file reader →
    map columns w/ sample values, saved-template load/save, custom-field
    marking → review table w/ warnings + custom columns + encrypted-SIN badge
    → done w/ "Undo this import"); recent-batches table; clerk/accountant get
    a friendly denial page. Settings → Retention review (ADR-0034):
    counts + posture explainer + past-horizon table (read-only, no delete).
    /app/documents/bulk (ADR-0035): many-files-to-one-client drag/drop over
    the EXISTING /api/vault/upload pipeline, concurrency 3, per-file
    scan-status polling; linked from intake + import pages.
  - Hardening: tests/redteam.test.ts — deliberate cross-org probes through
    OrgScope reads AND writes, the permission layer (TenancyViolationError +
    audit), the AI read tools (no existence leak, no SIN in any payload), and
    raw app-role SQL across 11 tenant tables incl. the import trio (zero rows
    w/o GUC, org-B scope can't see org A, cross-org INSERT rejected);
    dependency audit → pnpm.overrides (esbuild ≥0.25, postcss ≥8.5.10,
    sharp ≥0.35) → **pnpm audit: No known vulnerabilities**; scripts/backup.ts
    (pg_dump -Fc → S3, --dry-run, PG_DUMP override; verified locally, 0.29 MB
    dump on PG17); scripts/cleanup-orphaned-s3.ts (deleted-org prefix sweep,
    dry-run default); backups/ gitignored. §6 evidence table in TESTING.md.
  - Seed: 2 import mapping templates ("Old software export" for Lakeside +
    an org-2 isolation row).
  - Tests: 206 Vitest (34 new: imports.test.ts 16 — parser/mapping/
    validation/SIN-safety/commit/partial-rollback/isolation/RLS/matrix;
    redteam.test.ts 15; retention.test.ts 3) + 31 Playwright (3 new in
    m9.spec.ts, incl. the ACCEPTANCE: messy CSV → warnings + skipped row →
    custom field visible on the client page + SIN stored encrypted/masked →
    rollback restores the exact pre-import state). Production build verified
    (incl. after the dependency-override bumps).

- **M10 — Polish + deploy** (this commit):
  - **Dashboards (ADR-0036)**: "Documents outstanding" card wired to the real
    missing-required count (countMissingRequiredDocuments — items + distinct
    returns, assignee-scoped on the accountant variant, links to Returns;
    the "Arrives in M3" placeholder is gone). NEW front-desk dashboard for
    clerks (the personal variant read as zeros — customer-noted): documents
    in intake w/ not-yet-cleared badge, firm-wide awaiting-docs + documents
    outstanding, intake-queue and recent-portal-uploads cards
    (listRecentPortalUploads), quick actions. Firm-wide per ADR-0023; no new
    data authority.
  - **AI usage viewer (ADR-0036)**: Settings → AI usage — every ai_interaction
    run (asker, feature, tools+counts, model, tokens, expandable
    prompt/response). Gated by the EXISTING audit.view (owner/admin);
    listAiInteractionsWithUsers join.
  - **Capture quality (M4 backlog, customer-deferred)**: multi-strategy
    detection (adaptive-threshold → contours → largest-quad fallback behind
    jscanify's Canny pass, same quality gate), auto-capture after a ~1.2 s
    steady quad (default on, one big checkbox off), drag-the-corners
    adjustment on review (extractPaper custom cornerPoints, whole-surface
    touch targets). Every failure still lands on the native camera input.
    NEEDS SATINDER: real-device pass (TESTING.md "Manual checklist — M10").
  - **E-sign placement is pixel-accurate (ADR-0037)**: pdfjs-dist renders the
    real page into each placement box's background canvas; geometry model,
    stamping and tests unchanged (render is cosmetic, degrades to M6's blank
    boxes). Bytes via new same-origin /api/esign/[id]/source (signatures.view
    + assignment, audited, clean docs only); worker vendored to
    /public/vendor on postinstall; zero CSP additions.
  - **Shell polish**: staff + portal error.tsx (Next 16 unstable_retry),
    staff loading.tsx skeleton, staff + root not-found.tsx (assigned-only
    404s now styled, still no existence leak), global-error; print styles
    (@media print + print:hidden chrome — reports/invoices print clean).
    Marketing page: features grid + real pricing ($300/firm flat, ADR-0012).
    **Gotcha fixed en route**: a portal loading.tsx made Next STREAM
    metadata (title appended to <body> late) → axe document-title AAA
    failure on every portal screen. The portal therefore has NO loading.tsx
    (no early flush → blocking <head> titles). Do NOT "fix" this with
    `htmlLimitedBots: /.*/` — treating every UA as an HTML-limited bot broke
    interactive flows suite-wide (hung post-action navigations, stray 404s);
    see the note in next.config.ts.
  - **Deploy + demo**: docs/DEPLOYMENT.md (provisioning, env table, Stripe
    live, SES production access + firm-domain DKIM/SPF/DMARC, Twilio webhook,
    backup + s3-cleanup schedules incl. restore drill, go-live smoke, update
    procedure) and docs/WALKTHROUGH.md (scripted ~20-min demo on the seed;
    each step mapped to its covering spec — the green e2e suite IS the
    machine-checked walkthrough). Both linked from CLAUDE.md.
  - Tests: 209 Vitest (3 new: dashboard.test.ts count/uploads scoping +
    isolation; ai.test.ts usage-viewer join) + 36 Playwright (5 new in
    m10.spec.ts: front-desk dashboard vs DB counts; owner card wired +
    linked; pdf.js canvas actually painted through the new source route with
    placement/cancel intact; AI usage owner-sees/clerk-denied; styled 404 +
    pricing page). auth/m1 clerk-landing assertions updated to the front-desk
    variant. m10.spec sorts between m1 and m2 — it is seed-only and
    additive/self-cleaning by design. Production build verified.

- **Post-M10 fix (2026-07-23): import commit crashed on impossible calendar
  dates.** test-data/clients-100.csv row "Odd Data Example" carries DOB
  `31/02/1990`; normalizeDob's range check accepted Feb 31 → Postgres
  rejected the insert → the WHOLE commit transaction failed as an unhandled
  runtime error. Fixed three ways: isoOrWarn now calendar-validates (new
  exported isRealIsoDate; leap days still pass), commitImportBatch re-checks
  dates defensively (batches staged BEFORE the fix still carry the bad
  value — re-staging is not required), and the commit action catches DB
  errors into a friendly message + server log instead of crashing the page.
  +1 Vitest (210). Customer's failing batch: just press Commit again — the
  guard nulls the bad DOB (row-level warning already flagged it as ambiguous).
- **Post-M10 diagnosis (2026-07-23): customer "AI chat wouldn't work"
  (Satinder, org "Sandhu Tax").** NOT a code bug: reproduced the exact
  server path (askAssistant, same org/user/key, empty org) — SUCCESS against
  live claude-opus-4-8, and 3× HTTP 200 to the API. ai_interaction had zero
  rows (the run threw before logging), key healthy, ai_enabled true, owner
  role fine. Everything points at the KNOWN intermittent host-AV (Norton)
  TLS interception (see 3b79640). The friendly-error catch now logs the real
  cause — when it recurs, read the dev-server console for "ai run failed".
  Note: the repro wrote one real ai_interaction row in Sandhu Tax's AI usage
  viewer (asker Satinder, "How does the pipeline look?").
- **Post-M10 fixes round 2 (2026-07-23, customer-prioritized "fixes first,
  then Stripe"):** four gaps closed —
  1. **Forgot password + admin 2FA reset (ADR-0039):** /forgot-password +
     /reset-password pages (better-auth requestPasswordReset; reset email
     rides the org outbox → `pnpm outbox` in dev; sessions revoked on
     reset), "Forgot password?" link on login, and Settings → Employees
     "Reset 2FA" per member (employees.manage, audited, owner-guarded,
     src/lib/staff-recovery.ts clears TOTP + sessions → forced re-enroll).
     `pnpm reset:login` stays as the solo-owner last resort.
  2. **Google-on-password-account explains instead of erroring (ADR-0038):**
     login branches on the OAuth ?error code; `account_not_linked` gets
     precise guidance. Implicit linking deliberately NOT enabled — better-
     auth social sign-in skips the TOTP challenge (bypass documented in the
     ADR; safer-option rule applied).
  3. **Billing defaults card (Settings):** default hourly rate + tax
     label/percent editable (org.update_settings, audited), stored as
     ADR-0030 cents/bps via org.settings.billing. "No billing-settings UI"
     limitation below is CLOSED.
  4. **Household management:** /app/clients/households (linked from the
     clients grid) — member lists, rename, merge-with-move, delete-empty.
     Mutations authorize clients.update with no assignee (owner/admin, same
     rule as bulk distribute); OrgScope methods + org-isolation tests.
     "No household management page" limitation below is CLOSED.
  Tests: 228 Vitest green (+ households.test.ts 6, recovery.test.ts 1);
  typecheck + lint clean. **Not run:** production build and the e2e suite —
  the customer's live dev server (org "Sandhu Tax") is running against this
  checkout and shares .next/, and e2e requires a reseed that would wipe
  their org. Run `pnpm build` + `pnpm test:e2e` after the next reseed.
  **Flagging Satinder (manual, ~5 min):** forgot-password round trip in dev
  (link via `pnpm outbox`), Reset 2FA on a test member, and the new
  Google-error message wording.
- **Specs written, NOT scheduled (2026-07-23):** docs/SPEC_STRIPE_PAYMENTS.md
  (M11 candidate — Stripe Connect Express, client invoice payment, cards +
  Canadian PAD) and docs/SPEC_SMART_INTAKE.md (M12 candidate — portal
  questionnaires, drafts-not-writes review). Build only when asked; email
  sync deliberately deferred.

## IN PROGRESS
- Nothing — ALL MILESTONES COMPLETE. The product is feature-complete against
  the spec; remaining work is deployment (docs/DEPLOYMENT.md) and the manual
  device checks below.
- **Flagging Satinder (manual, real device):**
  - M10 capture-quality pass — TESTING.md "Manual checklist — M10" (tunnel +
    handset, ~15 min): low-contrast detection, auto-capture, corner
    adjustment, camera-denied fallback; plus a desktop e-sign placement spot
    check and a print check.
  - Still-open older item (optional): REMOTE signing on a real phone through
    a tunnel (M6 note below) — in-person is fully covered by e2e.

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
- ~~Vault documents have no delete path; M9 adds the retention flow~~ DONE
  (M9, ADR-0034): the no-delete posture is deliberate and permanent; the
  retention REVIEW surface is Settings → Retention review. Quarantined
  (infected/scan_failed) files remain deletable via documents.manage.
- ~~Deleting an org leaves S3 objects under org/{orgId}/~~ DONE (M9):
  `pnpm s3:cleanup` (scripts/cleanup-orphaned-s3.ts) sweeps deleted-org
  prefixes; dry-run by default. Run it after any org deletion (or on a
  schedule in production).
- Google-only accounts still can't enroll TOTP (twoFactor.enable needs a
  password). Candidate fix in a later milestone: better-auth setPassword
  path for OAuth-only accounts. Related: Google sign-in on an existing
  password account now explains instead of erroring, and implicit linking
  is deliberately off — better-auth social sign-in skips the TOTP
  challenge (ADR-0038).
- Multi-org users still land in their first org (switcher deferred).
- checkout.session.completed relies on client_reference_id; sessions created
  outside the app are ignored by design.
- Clients grid filters/search run client-side on the org's full (scoped)
  list — fine at small-firm scale; move search server-side if a firm's list
  grows past a few thousand.
- ~~Households are created inline from the client form; there's no dedicated
  household management page (rename/merge) yet~~ DONE (post-M10 fixes
  round 2): /app/clients/households — rename, merge, delete-empty.
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
- ~~E-sign field placement is on blank aspect-true page boxes~~ DONE (M10,
  ADR-0037): pdf.js renders the real page behind the boxes — pixel-accurate
  placement; degrades to the blank boxes if the render fails.
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
- ~~**No billing-settings UI**~~ DONE (post-M10 fixes round 2): Settings →
  Billing defaults card edits org.settings.billing (rate + tax label/bps).
- **AFR matching covers the common slip families** (T4 group, T5 group, T3,
  T2202, RRSP, RC62); unknown slip types fall back to a literal token match
  and land as "untracked" at worst — never silently dropped.
- Seed authorization expiries are fixed dates (Hélène 2026-09-15, Blackwood
  2026-01-31), same convention as the portal-token fixture dates: the seeded
  "expiring soon" badge reads correctly while the dev clock sits in the 2026
  season; unit tests pin `today` explicitly.
- ~~Clerk (front-desk) dashboard reads mostly zero~~ DONE (M10, ADR-0036):
  clerks land on the front-desk dashboard — intake queue, firm-wide
  documents outstanding, recent portal uploads, quick actions.
- ~~Dashboard "Documents outstanding" card is a stale pre-M3 placeholder~~
  DONE (M10): wired to countMissingRequiredDocuments, scoped firm-wide vs
  assigned, links to Returns.
- ~~Page detection quality "good enough", deferred to M10~~ DONE (M10):
  multi-strategy detector (adaptive-threshold fallback), auto-capture on a
  steady quad, drag-to-adjust corners on review. Torch toggle + client-side
  downscale remain future candidates (not customer-noted). Real-device pass
  pending with Satinder (TESTING.md M10 checklist).
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

## NEXT CONCRETE STEPS (post-M10 — no milestones remain)
1. Satinder: M10 real-device pass (TESTING.md "Manual checklist — M10") and,
   optionally, the M6 remote-signing phone check.
2. Production deployment per docs/DEPLOYMENT.md — start with §4 (SES
   production access + firm-domain DNS: approvals take days).
3. Demo to Joey using docs/WALKTHROUGH.md on a fresh `pnpm db:reset`.

M8 leftovers worth knowing:
- **Real-model path VERIFIED (2026-07-23).** A real ANTHROPIC_API_KEY was
  added to .env; live claude-opus-4-8 auth/credits/model confirmed and the
  AI pages surfed in the dev UI (real prose answers, role scoping visible
  Joey vs Sam). **NEW live-creds hazard:** .env now also holds a real
  ANTHROPIC_API_KEY. The outbox prefix does NOT blank it, so `pnpm test` /
  `test:e2e` with it set will hit the REAL API — and the M8 tests assert on
  the DETERMINISTIC MOCK output (exact strings like "2025 T1"), so live prose
  makes them mis-assert AND costs tokens. Blank it for tests too:
  `ANTHROPIC_API_KEY= EMAIL_MODE=outbox TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_FROM_NUMBER= pnpm test`
  (mock mode is what the suite is written for). Saved as a memory.
- ~~The AI usage log has no staff-facing viewer~~ DONE (M10, ADR-0036):
  Settings → AI usage, gated by audit.view.
