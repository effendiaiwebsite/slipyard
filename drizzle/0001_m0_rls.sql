-- Row Level Security: defense-in-depth beneath the scoped repository layer.
-- The app connects as the non-superuser role `crm_app` (created by
-- scripts/setup.ts; grants applied by scripts/migrate.ts). FORCE makes RLS
-- apply even to the table owner, so a misconfigured connection is still safe.
--
-- Session GUCs, set transaction-locally by src/db/scoped.ts:
--   app.org_id  — the tenant scope for the current transaction
--   app.user_id — the acting staff user (arms the pre-org membership lookup)

-- Ensure the app role exists even when migrations run before scripts/setup.ts
-- (e.g. CI). Password is a dev default; production manages its own role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE "org" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_membership" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_membership" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- org: visible when it IS the current tenant, or (login flow, before an org
-- is chosen) when the acting user has an active membership in it.
CREATE POLICY org_tenant ON "org"
  USING (
    id = NULLIF(current_setting('app.org_id', true), '')::uuid
    OR id IN (
      SELECT org_id FROM org_membership
      WHERE user_id = NULLIF(current_setting('app.user_id', true), '')
        AND status = 'active'
    )
  );
--> statement-breakpoint

-- org_membership: tenant-scoped, plus a user may always see their own
-- membership rows (needed to establish org context at login).
CREATE POLICY org_membership_tenant ON "org_membership"
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.user_id', true), '')
  );
--> statement-breakpoint

CREATE POLICY invitation_tenant ON "invitation"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY audit_log_tenant ON "audit_log"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- audit_log is append-only for the app role: SELECT + INSERT, never
-- UPDATE/DELETE. (scripts/migrate.ts re-applies this revoke after its broad
-- grant on every run.)
REVOKE UPDATE, DELETE ON "audit_log" FROM crm_app;
