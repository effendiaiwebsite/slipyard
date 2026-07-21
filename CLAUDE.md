@AGENTS.md

# Accountant CRM — multi-tenant practice CRM for Canadian accounting firms

Licensable SaaS: firms subscribe monthly (Stripe, per-seat), add employees with
role-based permissions, and manage clients, documents, e-signatures, CRA
authorizations, and AI-assisted workflows. Sits BESIDE the firm's EFILE tax
software — this is not tax software. No appointment booking. First customer:
two-practice firm (owner Joey), elderly/non-technical clientele.

## Session start (every session)
1. Read this file, `docs/PROGRESS.md`, `docs/MILESTONES.md`.
2. Do NOT re-derive decisions — `docs/DECISIONS.md` is the log.
3. Continue the next unchecked milestone. Stop at milestone boundaries.
4. End of milestone: update context files, full test suite green, commit `M<n>: <summary>`.

## Stack (decided — do not substitute)
Next.js 16 App Router + TS (single app) · Postgres (Drizzle ORM, node-postgres)
· better-auth (email+password, Google, mandatory TOTP) · Stripe subscriptions ·
pg-boss jobs (from M5) · S3 ca-central-1 + KMS (from M3) · ClamAV · Twilio/SES
behind outbox-pattern services · Anthropic API behind AiService (mock without
key) · Tailwind 4 + shadcn/ui + Lucide + Inter · TanStack Table · zod · pino ·
Vitest + Playwright.

## Iron rules
- **Tenancy**: every tenant table has `org_id`; ALL queries via `src/db/scoped.ts`
  (`OrgScope`) — never raw `db` from handlers. Postgres RLS (FORCEd) is
  defense-in-depth. S3 keys `org/{orgId}/...`. Tokens embed+validate org_id.
- **Permissions**: single matrix in `src/lib/permissions.ts`; mutations go
  through `authorize()` which writes `audit_log`. Roles: owner/admin/accountant/clerk.
- **AI drafts only**: never writes records, never auto-sends, never auto-classifies.
  No SIN/full DOB to model APIs. Per-org AI toggle.
- **SIN**: AES-256-GCM app-layer encrypted (`src/lib/crypto.ts`), masked display,
  never in logs/URLs/exports.
- **No real client data.** Seeds are fictional + deterministic (`scripts/seed.ts`).
- Conflicts → record in DECISIONS.md, choose safer option, flag in PROGRESS.md.

## Layout
- `src/app/` — `page.tsx` marketing stub · `(auth)/` login, signup, setup-mfa,
  verify-mfa, no-organization · `(staff)/app/**` staff CRM (layout gates via
  `requireStaff()`) · `portal/` client portal (token-gated from M4; big-type
  AAA theme `.portal-theme`) · `api/auth/[...all]` better-auth.
- `src/db/` — `schema/` (auth.ts, tenancy.ts), `scoped.ts` (OrgScope — THE data
  path), `index.ts` (raw handle: auth adapter + scripts only).
- `src/lib/` — `env.ts` (typed, fail-fast), `auth.ts`, `context.ts`
  (requireStaff: session→MFA→idle→membership), `permissions.ts`, `crypto.ts`,
  `logger.ts`.
- `scripts/` — setup.ts, migrate.ts, seed.ts, reset.ts, db-lib.ts.
- `drizzle/` — migrations; `0001_m0_rls.sql` is the RLS layer (hand-written).
- `tests/` (Vitest) · `e2e/` (Playwright) · `.github/workflows/ci.yml`.
- `design-reference/` — prior UI-only mock. Mirror staff-app look (sidebar,
  cards, tables, badges); NEVER import its code/fixtures; ignore its
  bookkeeping/payroll sections. Excluded from tsconfig + eslint.

## Commands
- `pnpm run setup` — .env + db + role + migrate + seed (NOTE: `pnpm setup` bare
  hits pnpm's builtin; use `run`). Needs local Postgres (docker compose up -d
  postgres, or native with postgres/postgres superuser).
- `pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint`
- `pnpm db:generate --name x` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset`
- `pnpm test` (Vitest; needs migrated DB) · `pnpm test:e2e` (Playwright; needs
  seeded DB — e2e enrolls 2FA for the clerk user, reseed to reset)

## Dev logins (seed; password `demo-password-123`)
joey@lakesidecpa.test (owner) · maria@ (admin) · sam@ (accountant) ·
priya@ (clerk) — org Lakeside CPA. nina@northerntax.test (owner, org 2,
isolation testing). First login forces TOTP enrollment.

## Docs
`docs/ARCHITECTURE.md` (tenancy, flows) · `docs/DATA_MODEL.md` (authoritative
schema) · `docs/MILESTONES.md` (checkboxes, never reorder) · `docs/PROGRESS.md`
(state + next steps) · `docs/DECISIONS.md` (ADRs) · `docs/TESTING.md`.
