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

**Document upload (M3, ADR-0016)** — browser → multipart POST
/api/vault/upload (same-origin enforced; type allowlist + 25 MB cap) →
bytes land at `org/{orgId}/quarantine/{docId}/` → synchronous ClamAV
INSTREAM scan → clean: promoted to `org/{orgId}/vault/{docId}/` · infected:
stays quarantined, flagged, never downloadable · scanner down: scan_failed,
retryable. Uploading against a checklist item marks it received and runs
the auto-advance rules (category-keyed, ADR-0017). Reads via 5-min presigned
GET, clean documents only. pg-boss takes over scanning at M5.

**Portal magic link (M4)** — staff/reminder sends link with JWT (embeds
org_id, client_id, scopes; 15-min opened / 7-day unopened TTL) → 6-digit SMS
OTP (max 5 attempts) → three-card home. Rate-limited per token + IP.

**Signing (M6)** — signature_pad → pdf-lib stamps signature + datetime
(YYYY/MM/DD HH:MM:SS org TZ) + audit page (signer, method, IP, token id,
source hash). Originals immutable.

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
