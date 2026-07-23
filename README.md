# SlipYard

Multi-tenant practice CRM for Canadian accounting firms: clients, documents,
e-signatures, CRA authorizations, messaging, and AI-assisted workflows —
beside the firm's tax software, never replacing it.

## Quick start (dev)

Prereqs: Node 22+, pnpm 9+, and Postgres — either `docker compose up -d
postgres` or a native install with a `postgres/postgres` superuser (override
via `DATABASE_ADMIN_URL` in .env).

```bash
pnpm install
pnpm run setup   # .env + database + crm_app role + migrations + seed
pnpm dev         # http://localhost:3000
```

(Note: `pnpm run setup`, not `pnpm setup` — the bare form hits a pnpm builtin.)

Seed logins are printed by setup; all use password `demo-password-123`. First
login walks you through mandatory TOTP enrollment.

## Tests

```bash
pnpm test        # Vitest — tenancy isolation, permissions, crypto
pnpm test:e2e    # Playwright — shells + full login/MFA flow (seeded DB)
```

## Where everything is

Start with [CLAUDE.md](CLAUDE.md) (conventions, layout, commands), then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md),
[docs/MILESTONES.md](docs/MILESTONES.md), [docs/PROGRESS.md](docs/PROGRESS.md).
