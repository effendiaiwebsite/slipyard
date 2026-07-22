-- M5 RLS: message_template + message get the standard tenant policy
-- (0001_m0_rls.sql is the model), plus two GUC-as-credential policies
-- (ADR-0009) for system paths that legitimately run without an org context,
-- and the pgboss schema for the M5 job runner.

ALTER TABLE "message_template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_template" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY message_template_tenant ON "message_template"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY message_tenant ON "message"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- Reminders sweep (system job, no org context): may ENUMERATE orgs — read
-- only — while the transaction-local app.system_job GUC is armed by
-- listOrgsForReminderSweep(). Per-org work then uses a normal OrgScope.
CREATE POLICY org_system_sweep ON "org"
  FOR SELECT
  USING (current_setting('app.system_job', true) = 'reminders-sweep');
--> statement-breakpoint

-- Twilio inbound STOP/START (signature-validated webhook, org unknown):
-- expose exactly the client rows whose phone matches the armed GUC, read
-- only. The consent UPDATE runs per-org through OrgScope afterwards.
CREATE POLICY client_by_phone ON "client"
  FOR SELECT
  USING (
    phone IS NOT NULL
    AND phone = NULLIF(current_setting('app.sms_from', true), '')
  );
--> statement-breakpoint

-- pg-boss (M5 job runner) keeps its queue tables in its own schema, created
-- and migrated by the library at boss.start(). The app role owns the schema
-- so pg-boss can run its internal DDL without superuser rights. Not tenant
-- data; payloads carry row ids only.
CREATE SCHEMA IF NOT EXISTS "pgboss" AUTHORIZATION crm_app;
