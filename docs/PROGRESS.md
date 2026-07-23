# Progress

_Last updated: 2026-07-22 (M5 complete — real-SMS live test pending Twilio creds)_

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

## IN PROGRESS
- Nothing — stopped at the M5 boundary. **Flagging Satinder:** everything
  is outbox-first and green; to light up real messaging I need (1) Twilio
  SID + auth token + a Canadian number, (2) a VERIFIED SES sender address
  (then EMAIL_MODE=ses). After keys land: send a real SMS + email via the
  Messaging page, and point the Twilio number's inbound webhook at
  {APP_URL}/api/webhooks/twilio to live-test STOP/START.

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
- Portal "Sign a form" card is a static placeholder until M6.
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

## NEXT 3 CONCRETE STEPS (M6 — E-signature)
0. (Carry-over from M5, blocked on Satinder: wire real Twilio + SES creds
   into .env, live-test one SMS + one email + STOP via the webhook.)
1. Signature request schema + RLS (document link, signer, placement coords,
   status lifecycle draft→sent→viewed→signed→declined), T183-style PDF
   field placement UI, hashed signing tokens reusing the portal-token
   pattern (ADR-0003/0018).
2. Remote signing flow through the portal theme (big-type AAA), in-person
   signing mode on a staff device; signature stamping onto the PDF with the
   CRA-required timestamp format; executed PDF immutable in the vault
   (never overwrite the original).
3. Audit page per signature (who/when/IP chain), dashboards ("out for
   signature" via awaiting_signature category), notifications through the
   M5 messaging layer (outbox-first), Playwright covering
   draft→sent→signed with a correct timestamp and immutability probe.
