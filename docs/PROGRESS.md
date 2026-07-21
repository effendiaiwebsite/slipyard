# Progress

_Last updated: 2026-07-21 (M0 complete)_

## DONE
- **M0 — Foundation** (committed as `M0: ...`). Next 16 + TS + Tailwind 4 +
  shadcn primitives; Drizzle schema (auth + tenancy) with FORCEd RLS and
  non-superuser `crm_app` role; OrgScope repository layer; typed env.ts;
  better-auth email+password & Google (button hidden w/o keys) with mandatory
  TOTP (enroll-on-first-login, backup codes, brute-force lockout); permission
  matrix + authorize() + append-only audit_log; staff shell with
  design-reference sidebar/topbar + 15 placeholder pages; portal AAA-theme
  shell; marketing stub; security headers; deterministic 2-org seed; Vitest
  (20 tests) + Playwright (3 tests incl. full MFA flow); GitHub Actions CI;
  docker-compose (PG16+ClamAV); all context docs.

## IN PROGRESS
- Nothing — stopped at the M0 boundary per working method.

## KNOWN BUGS / LIMITATIONS
- Google-only accounts can't enroll TOTP via twoFactor.enable (needs
  password). M1 invite flow must handle this (set password on join, or
  better-auth password-set path). Noted on /setup-mfa.
- Multi-org users: first membership wins; active-org switcher cookie is M1.
- Search box in topbar disabled until M2.
- `pnpm dev` on Windows: dev-mode CSP warning about eval is expected (dev
  only; prod CSP has no unsafe-eval).
- Docker not installed on the current dev machine — using native PostgreSQL
  17 service (ADR-0007). ClamAV needed by M3.

## NEEDS SATINDER'S / JOEY'S REVIEW
- ADR-0004: accountant_scope_mode default 'all_read' (accountants read all
  firm clients, write assigned) — confirm with Joey.
- Seat-count billing detail for M1: does a deactivated employee free a seat
  immediately or at period end?
- Missing .env keys (see list at the end of the M0 session summary / README).

## NEXT 3 CONCRETE STEPS (M1)
1. Signup → org creation transaction (pre-generated org UUID + set_config
   pattern per ARCHITECTURE.md) + owner membership + /no-organization →
   "create your firm" flow.
2. Stripe: checkout session (14-day trial, quantity = active seats), webhook
   handler (signature-verified, idempotent), subscription_status → read-only
   grace-mode middleware/banner, Customer Portal link in settings.
3. Invitations: table exists — build create/revoke UI (owner/admin), email +
   SMS delivery through outbox-pattern services (console + outbox table in
   dev), accept flow (password or Google) → forced TOTP → personal dashboard.
   Playwright: invite→join→MFA→dashboard; lapse→read-only.
