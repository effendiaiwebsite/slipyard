# Testing

## Commands
| what | command | needs |
|---|---|---|
| Unit/integration (Vitest) | `pnpm test` | migrated DB (`pnpm db:migrate`), .env |
| E2E (Playwright, spins up dev server) | `pnpm test:e2e` | seeded DB (`pnpm db:seed`); first time: `pnpm exec playwright install chromium` |
| Types / lint | `pnpm typecheck` / `pnpm lint` | — |
| Everything CI runs | typecheck, lint, db:migrate, test, build | see `.github/workflows/ci.yml` |

Note: the e2e MFA test enrolls TOTP for priya@ (clerk). Re-run `pnpm db:seed`
to reset. Vitest DB tests create their own fixtures (random UUIDs) and clean
up — they don't depend on the seed.

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
