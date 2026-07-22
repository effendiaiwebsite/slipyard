# Progress

_Last updated: 2026-07-22 (M4 complete)_

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

## IN PROGRESS
- Nothing — stopped at the M4 boundary.

## KNOWN BUGS / LIMITATIONS
- Scanning is synchronous in the upload request (ADR-0016) — acceptable at
  25 MB/small-firm scale; moves to pg-boss at M5.
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
- Portal "Sign a form" card is a static placeholder until M6.

## NEEDS SATINDER'S / JOEY'S REVIEW
- ADR-0004 accountant_scope_mode default (carried over from M0).
- **M4 manual verification (needs Satinder's phone + a tunnel)**: real-SMS
  portal flow end-to-end and the jscanify camera capture on a real handset
  — checklist in TESTING.md ("M4 manual items"). Everything else in the M4
  acceptance line is green (axe AAA, e2e).
- ADR-0019: clerks may issue/revoke portal links (front-desk workflow) —
  confirm Joey's comfortable with that.
- ~~ADR-0013 stage names~~ RESOLVED by ADR-0015: stages are per-org editable
  (Settings → Workflow stages); Joey tunes his own template.

## M3 PREREQUISITES (done 2026-07-21 with Satinder)
- Dev S3 bucket `accountant-crm-dev` (ca-central-1, versioned, private);
  IAM user `accountant-crm-dev-app`; keys in .env. KMS deferred to prod.
- Docker Desktop (Windows 11 Home / WSL2); crm-clamav container healthy,
  verified 2026-07-22 (PING/clean/EICAR over INSTREAM).
- AWS budget alarm skipped for now (new account on free credits with
  automatic credit-exhaustion notifications).

## NEXT 3 CONCRETE STEPS (M5 — Messaging)
1. message_template + message tables (RLS), template variables
   ({client_name}, {missing_docs}, …), Settings → Templates
   (messages.manage_templates); real Twilio + SES adapters behind the
   existing outbox pattern (env-gated; outbox/console stays the dev mode).
2. pg-boss (stack decision: from M5) — job runner wiring, reminder
   policies keyed on stage CATEGORY (ADR-0015) + checklist state, e.g.
   "awaiting_docs for N days → nudge missing items"; move document
   scanning out of the upload request into a job (revisit of ADR-0016).
3. Mass send (filtered client list → templated batch, per-recipient outbox
   rows), consent/STOP handling for SMS, send log on the client contact
   timeline. Accelerated-clock e2e proving a scheduled reminder fires.
