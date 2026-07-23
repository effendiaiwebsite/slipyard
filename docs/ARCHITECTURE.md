# Architecture

One Next.js app, one Postgres, three surfaces:

```
                    ┌─────────────────────────────────────────────┐
                    │                Next.js app                  │
                    │                                             │
  firm owner ──────▶│  /            marketing, pricing, signup    │
  staff ───────────▶│  /app/*       staff CRM (session+MFA+sub)   │
  firm clients ────▶│  /portal/*    token-gated, no accounts      │
  Stripe ──────────▶│  /api/webhooks/stripe (sig-verified, M1)    │
                    │  /api/auth/*  better-auth                   │
                    └──────┬──────────────┬───────────────────────┘
                           │              │
                    ┌──────▼──────┐  ┌────▼─────────────────────┐
                    │ Postgres    │  │ S3 ca-central-1 (M3)     │
                    │ + RLS       │  │ org/{orgId}/quarantine/  │
                    │ + pg-boss   │  │ org/{orgId}/vault/…      │
                    │   (M5)      │  │ org/{orgId}/signed/      │
                    └─────────────┘  └──────────────────────────┘
       Side services: ClamAV (scan, M3) · Twilio/SES via outbox (M5)
                      · Anthropic AiService, mock w/o key (M8)
```

## Tenancy model (the #1 invariant)

Three defensive layers, all independently tested (`tests/tenancy.test.ts`):

1. **Scoped repository** — `src/db/scoped.ts` `OrgScope(orgId, userId)`. The
   only sanctioned path to tenant data. Handlers get one exclusively from
   `requireStaff()` (`src/lib/context.ts`), which mints it from the session's
   org membership — never from user input. Every query filters `org_id`
   explicitly.
2. **Postgres RLS** — every tenant table is `ENABLE + FORCE ROW LEVEL
   SECURITY` (`drizzle/0001_m0_rls.sql`) keyed on transaction-local GUCs
   `app.org_id` / `app.user_id` that `OrgScope.tx()` sets via `set_config(...,
   true)`. The app connects as non-superuser `crm_app`, so even raw SQL that
   bypasses the repository can't cross orgs. Auth tables (staff_user,
   auth_session, …) are deliberately NOT org-scoped: users can belong to
   multiple orgs and must resolve before org context exists.
3. **Permission layer** — `can()` throws `TenancyViolationError` on any
   cross-org resource reference (never a soft deny) and `authorize()` records
   the attempt in audit_log.

Bootstrap notes:
- Org creation (M1 signup): pre-generate the org UUID, `set_config('app.org_id',
  newId)`, then insert org + owner membership in that transaction — satisfies
  RLS WITH CHECK without a bypass path.
- Pre-org membership lookup at login uses the secondary policy
  (`user_id = app.user_id`) via `listMembershipsForUser()`.
- Migrations/seeds run as the DB owner (DATABASE_ADMIN_URL) and legitimately
  bypass RLS.

## Key flows

**Staff login** — /login → better-auth email+password (or Google) → if 2FA
enrolled: /verify-mfa (TOTP or backup code) → /app. If NOT enrolled (first
login): `requireStaff()` redirects to /setup-mfa; no staff surface renders
until TOTP is verified. Idle timeout 30 min (checked in requireStaff against
session.updatedAt), absolute 12 h (better-auth expiresIn). TOTP brute-force
lockout via better-auth failedVerificationCount/lockedUntil.

**Signup → org creation** — account → /no-organization "create your firm" →
createOrgForUser bootstrap (see note above) with a 14-day app-level trial
(org.trial_ends_at) → owner may complete Stripe Checkout any time (remaining
trial days carry over as subscription_data.trial_period_days). Webhooks (+
the checkout success-redirect sync, ADR-0010) drive org.subscription_status.
Lapsed or trial-expired-unsubscribed ⇒ computeReadOnly() true ⇒ authorize()
blocks everything outside the grace allowlist (views + billing.manage), red
banner renders, write UIs disable. Never deletion.

**Employee invite** — owner/admin creates invitation (name, email, mobile,
role — never owner); token stored as sha256 hash (ADR-0003), raw token only
in the email+SMS link (outbox pattern; console in dev); 7-day expiry,
revocable → /join/[token] validates via the token-hash GUC policy
(ADR-0009) → invitee sets password (email locked to invite) or Google-links
(email must match) → acceptInvitation transaction (membership + stamp +
audit) → seat quantity syncs → forced TOTP → personal dashboard.

**Document upload (M3 ADR-0016; async scan M5 ADR-0021)** — browser →
multipart POST /api/vault/upload (same-origin enforced; type allowlist +
25 MB cap) → bytes land at `org/{orgId}/quarantine/{docId}/` → the request
returns; a pg-boss `document-scan` job runs ClamAV INSTREAM → clean:
promoted to `org/{orgId}/vault/{docId}/`, checklist slot satisfied,
auto-advance (category-keyed, ADR-0017) · infected: stays quarantined,
flagged, never downloadable · scanner down: scan_failed, job retries ×3,
retryable by staff after. Staff UIs poll /api/vault/scan-status for the
verdict; the portal answers "received" immediately (flagged files surface
to staff, not the client). Reads via 5-min presigned GET, clean documents
only. Runner off ⇒ the routes run the same job body synchronously.

**Messaging (M5, ADR-0022)** — templates ({placeholders}, Settings →
Templates) render per recipient; every client-facing send goes through
src/lib/client-messaging.ts: channel resolution (preferred → fallback) +
SMS consent (client.sms_opt_out_at) → a `message` send-log row per
recipient (skips included) → the outbox row → the env-gated adapter
(Twilio REST / SES; console+outbox in dev) → contact-timeline entry. Mass
sends fan out through `message-send` jobs; reminder policies (org.settings,
category-keyed like all automations) run in the `reminders-sweep` job —
pg-boss cron (prod) or a seconds-scale interval (dev/test, the accelerated
clock). Provider sends never auto-retry. Inbound Twilio STOP/START
(signature-validated webhook) flips consent for every org holding that
phone. The job runner starts with the Next server (src/instrumentation.ts);
queue state lives in the crm_app-owned `pgboss` schema.

**Portal magic link (M4, ADR-0018)** — staff issue a link from the client
detail page (portal.manage_links; clerk-friendly, ADR-0019) → SMS/email
carries `/portal/<jwt>` (JWT embeds org_id/client_id/scopes; the row stores
only its sha256). The GET only validates — a deliberate "Continue" press
stamps opened_at (link dies 15 min later; unopened links last 7 days) and
texts the 6-digit OTP (10-min, 5 wrong entries lock the link durably) →
signed 30-min session cookie → three-card home (Send a document / What we
still need / Sign a form [M6]). Trusted helpers get their own link (OTP to
THEIR phone), optionally scoped to the whole household. Uploads POST to
/api/portal/upload into the same quarantine/scan pipeline with
source=portal_upload; jscanify (vendored, ADR-0020) straightens phone
photos. Every anonymous endpoint is rate-limited per token + IP; every
portal request re-loads the token row, so staff revocation is immediate.

**Signing (M6, ADR-0024/25/26/27)** — staff create a signature_request from a
clean vault PDF and place fields on aspect-true page boxes (normalised coords,
no in-browser PDF renderer). Sending notifies the signer (M5 messaging,
outbox-first) and advances the linked engagement to the first
awaiting_signature-category stage (forward-only). The signer signs REMOTELY
inside the portal session (scope 'sign' — the OTP-verified token is the
authentication) or IN PERSON in the staff session on the firm's device. A
shared signature pad captures a drawn PNG or a typed name; pdf-lib
(src/lib/pdf.ts) stamps it + a CRA datetime (YYYY/MM/DD HH:MM:SS, org TZ) into
every field and APPENDS an audit page (signer, method, authentication, IP,
token id / operator, source SHA-256). The executed PDF is written as a NEW,
immutable object at org/{orgId}/signed/ (document source 'esign_executed') —
the source is never touched. "Out for signature" surfaces on /app/esign
(by request status) and the dashboard card. Multiple signers = one request per
client.

**AI suite (M8, ADR-0031/32)** — AiService (src/lib/ai/service.ts) fronts
claude-opus-4-8 behind ANTHROPIC_API_KEY; without a key a deterministic mock
engine drives the SAME read-only tool registry (src/lib/ai/tools.ts), so the
data path is identical in dev/test. Tools are the only surface the model can
reach: view-permission-checked, assigned-only-scoped
(viewAssignedOnlyFilter), payloads built field-by-field (SIN/DOB columns
unselected; SIN-shaped digit runs scrubbed from staff free text). The
registry contains NO writes — AI drafts only. Every run logs to
ai_interaction (RLS) and audits as ai.use. Audit-risk/optimize pages run
pure rule engines (src/lib/ai/insights.ts); the model only narrates their
output. The email drafter's send button is an ordinary M5 manual send
(messages.send_custom) the human triggers after editing — the AI has no
path to it. Per-org kill switch: org.settings.ai_enabled.

**Stripe webhooks (M1)** — signature-verified, idempotent handlers for
checkout.session.completed, customer.subscription.updated/deleted.

## Security posture (M0 state)

- Security headers (CSP, HSTS, frame-deny, nosniff) in `next.config.ts`.
- Mandatory TOTP for all staff; sessions 12 h absolute / 30 min idle.
- SIN field-level AES-256-GCM, key-id prefixed for rotation (`src/lib/crypto.ts`).
- audit_log append-only at the DB level (crm_app lacks UPDATE/DELETE).
- pino logging with redaction paths; no SIN/tokens/presigned URLs ever logged.
- CSRF: better-auth handles auth routes; staff mutations (M1+) will use
  server actions/route handlers with origin checks.

## Backups & retention (runbook lands with M9's scripts/backup.ts)

Planned: scheduled pg_dump to S3 (versioned, ca-central-1) + S3 cross-region
replication; 7-year retention job flags for admin review — no auto-delete.
Documents immutable after `filed`.
