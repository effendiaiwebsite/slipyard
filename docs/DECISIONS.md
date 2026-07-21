# Decisions (ADR log — append only, dated)

## ADR-0001 (2026-07-21) — Auth table names prefixed, model-mapped
better-auth's default model names (user/session/account) are generic; we map
them to `staff_user` / `auth_session` / `auth_account` / `auth_verification` /
`auth_two_factor` via the drizzle adapter's schema option. Makes "staff ≠
firm-clients" explicit at the schema level (clients of firms NEVER get rows
here — portal is token-only).

## ADR-0002 (2026-07-21) — RLS via transaction-local GUCs + FORCE, role crm_app
Policies key on `current_setting('app.org_id')` set with `set_config(..., true)`
inside every OrgScope transaction. FORCE ROW LEVEL SECURITY + non-superuser
app role means even owner-connection mistakes stay safe. Secondary policy
(`user_id = app.user_id`) on org/org_membership enables the pre-org login
lookup without a bypass. Migrations/seeds run as DB owner and legitimately
bypass RLS.

## ADR-0003 (2026-07-21) — Invite/portal tokens stored as sha256 hashes
`invitation.token_hash` (and portal_token later) store a hash; the raw token
exists only in the sent link. A DB leak must not yield live links.

## ADR-0004 (2026-07-21) — accountant_scope_mode default 'all_read'
Spec leaves the default open ("confirm with customer"). Default: accountants
read all firm clients, write only assigned. Rationale: small-firm reality
(colleagues cover for each other); the restrictive mode exists as a per-org
setting. **Needs Joey's confirmation** — flagged in PROGRESS.md.

## ADR-0005 (2026-07-21) — Idle timeout enforced in requireStaff, not middleware
30-min idle is checked server-side against `auth_session.updated_at`
(better-auth updateAge=5 min keeps it ≈ last activity); absolute 12 h is
better-auth `expiresIn`. Next 16 middleware/proxy runtime constraints make a
DB-backed check there fragile; every staff page/handler already passes
through requireStaff. Revisit if we add long-polling surfaces.

## ADR-0006 (2026-07-21) — `pnpm run setup` (not `pnpm setup`)
`pnpm setup` is a pnpm builtin (installs pnpm itself) and shadows package
scripts. The M0 acceptance command is therefore `pnpm run setup && pnpm dev`.
Documented in README + CLAUDE.md.

## ADR-0007 (2026-07-21) — Local dev DB may be native Postgres, not Docker
docker-compose (PG16 + ClamAV) is in-repo and canonical, but this dev machine
has no Docker; a native PostgreSQL 17 service works identically for M0–M2
(scripts/setup.ts creates db + crm_app role either way). ClamAV becomes a
real requirement at M3 — revisit then. Drizzle/SQL kept compatible with PG16.

## ADR-0008 (2026-07-21) — Seed passwords hashed with better-auth's own hasher
scripts/seed.ts imports `hashPassword` from better-auth/crypto so seeded
credential rows are indistinguishable from signup-created ones; no test-only
auth backdoors.
