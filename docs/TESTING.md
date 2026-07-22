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

## Automated coverage (M2)
- `tests/clients.test.ts` — SIN stored ciphertext-only (k1: prefix, no
  plaintext substring, roundtrip decrypts); client CRUD + notes + contact log
  through OrgScope; listClientsWithMeta merges latest engagement + last
  contact; assignedToId narrowing; transitionEngagement stamps
  status_timestamps; countEngagementsByStatus; org-B scope sees nothing of
  org A; raw app-role SQL on `client` blocked by RLS (no GUC ⇒ zero rows,
  cross-org filter ⇒ zero rows, cross-org INSERT ⇒ WITH CHECK error);
  engagements.create/transition matrix rules (accountant assigned-only,
  clerk deny).
- `e2e/m2.spec.ts` — accountant: grid renders seed book → search narrows →
  row click → detail (SIN masked `*** *** 286`, plaintext absent from DOM) →
  add note → log contact → stage transition persists across reload; board:
  own card draggable, colleague's locked, HTML5 drag lands + persists;
  clerk: no create/edit/transition affordances anywhere, board fully locked;
  tenant isolation: org-2 owner sees only org-2 clients/engagements;
  custom stages (ADR-0015): owner renames a stage + adds one in settings,
  board columns follow immediately.
- Custom stages (in `tests/clients.test.ts`): rename keeps the immutable
  key; new stages append then reorder; deleting an in-use stage returns
  'in_use' until a destination is given, then moves engagements; transition
  rejects a foreign org's stage id; stage lists/gets are tenant-isolated.

## Automated coverage (M3)
- `tests/documents.test.ts` — checklist templates instantiate per engagement
  type (idempotent; 'other' empty); auto-advance keyed on stage CATEGORY
  only: not_started+missing→awaiting_docs, satisfied→first in_progress,
  never moves in_progress-or-later, degrades to no-op when a custom pipeline
  lacks the target category; scan pipeline (S3+clamd mocked): clean→vault
  key promote, infected→flagged+stays quarantined, scanner outage→
  scan_failed never clean; documents permission matrix (clerk intake-only,
  accountant manage-assigned-only); document/checklist_item RLS (scope
  isolation + zero rows for app role without GUC); filename sanitization
  (path traversal, dot-files, specials).
- `e2e/m3.spec.ts` — REAL dev bucket + REAL local clamd: new engagement
  instantiates checklist and auto-advances to Awaiting docs; file upload
  against a checklist item → scanned clean → vaulted → item Received;
  remaining required item marked received → auto-advance to In preparation
  (persists); infected/scan-failed fixtures: flagged badges, no download
  affordance, Remove works, Rescan offered; clerk uploads to intake but has
  no filing controls; owner files a queued doc against a return (leaves
  queue); Returns page missing-docs rollup matches seed; org-2 owner sees
  only org-2 returns.

## Automated coverage (M4)
- `tests/portal.test.ts` — magic-link mint/validate: raw JWT never stored
  (sha256 only, ADR-0003), garbage/tampered/unknown → 'invalid', revocation
  honoured, 7-day unopened + 15-minute opened expiry; OTP challenge: code
  recovered from the outbox SMS (as a real client would), correct code
  verifies, wrong codes count durably and the 5th locks the link for good
  (correct code afterwards still refused), expired codes refused but a
  reissued code works, re-open inside the window reuses the outstanding
  code; tenancy: org B can't read/update org A tokens by id OR hash,
  cross-org permission references throw; matrix: clerk may manage links,
  accountant assigned-only; rate limiter allows→blocks→resets per window.
- `e2e/m4.spec.ts` — full portal journey with REAL bucket + clamd: clerk
  issues a link from the client page; the magic link + OTP are read from
  the outbox exactly as texted; the GET sends NO code (prefetch safety —
  count asserted), the deliberate Continue does; wrong code → friendly
  error, right code → three-card home with live missing-doc count;
  checklist speaks plain language ("Still needed" / "We have it"); "Send
  it" preselects the item and the upload runs the real scan pipeline →
  item checked off client-side, "In vault" + "Portal" badge staff-side;
  revoking an in-use link bounces the client's next navigation to the
  session-ended explainer; org-2 client pages show only org-2 links.
  **Axe runs on every portal screen** (wcag2a/aa/aaa + best-practice tags,
  including color-contrast-enhanced) and must report zero violations.

## Manual checklist — M4 (verified 2026-07-22 with Satinder)
Run over a Cloudflare quick tunnel (`cloudflared tunnel --url
http://localhost:3000`) with APP_URL pointed at the tunnel host, on a real
phone. `pnpm portal:link "<client>"` mints a link, prints a scannable QR,
and tails the outbox for the codes — SMS delivery isn't real until the M5
Twilio adapter, so the tester reads codes from there.
- [x] Magic link opens on the handset over HTTPS; welcome screen names the
  recipient and the phone tail; the GET sends no code.
- [x] "Continue" texts the code (outbox), the code screen accepts it, and
  the three-card home renders.
- [x] Checklist → "Send it" → camera capture → upload: 189 KB JPEG scanned
  clean, promoted to the vault as source=portal_upload, checklist item
  flipped to received. Round trip 7.7 s over the tunnel.
- [x] Detection failure path exercised for real: page filling the frame
  edge-to-edge on a pale counter → no page found → the unmodified photo is
  offered and uploads fine. Drove the live-outline + quality-gate rework
  (see PROGRESS.md; further tuning deferred to M10).
- [ ] Deferred to M10 polish: detection quality in low-contrast scenes,
  desktop-webcam pass, permission-denied → native input fallback.

### Dev note: `allowedDevOrigins`
Next blocks cross-origin dev-asset requests, so tunnel testing needs the
tunnel host in `allowedDevOrigins` (next.config.ts carries
`*.trycloudflare.com`). Symptom without it: the page shell loads but every
`/_next/*` asset 403s.

### M3 dev-machine caveat: host antivirus vs EICAR
Norton on this dev machine intercepts EICAR uploads to localhost over HTTP
(threat "WICAR Test - NOT A VIRUS"), resetting the connection before the app
sees it — and then blacklists the upload URL for a while, breaking BENIGN
uploads too (symptom: connection reset on exactly one path, nothing in the
server log). Consequences:
- The e2e suite does NOT push live EICAR through the browser. Real clamd
  detection was verified directly over the clamd TCP protocol (INSTREAM →
  `Eicar-Test-Signature FOUND`); verdict routing is covered in Vitest; the
  browser-facing contract (flagged, no download, removable) is asserted via
  the seeded infected fixture.
- The upload endpoint is `/api/vault/upload` — renamed after Norton
  blacklisted the original `/api/documents/upload`. If uploads ever start
  failing with connection resets and an empty server log, suspect the host AV
  first.

## Manual checklist — M3 (verified 2026-07-22)
- [x] ClamAV container healthy (`docker compose up -d clamav`); PING/PONG,
  clean INSTREAM scan `OK`, EICAR INSTREAM → `Eicar-Test-Signature FOUND`.
- [x] Seed uploads 6 fixture objects to s3://accountant-crm-dev (vault +
  quarantine keys); presigned-GET download of a vaulted doc opens from the
  client page.
- [x] Full Vitest (69) + Playwright (14) suites green against dev bucket +
  local clamd.

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
