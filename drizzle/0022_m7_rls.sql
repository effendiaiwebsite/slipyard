-- M7 RLS: cra_authorization, time_entry, invoice get the standard tenant
-- policy, keyed on the transaction-local app.org_id GUC (ADR-0002). These
-- tables are only ever touched from the authenticated staff session — no
-- portal/webhook path, so no GUC-as-credential policies are needed.

ALTER TABLE "cra_authorization" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cra_authorization" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cra_authorization_tenant ON "cra_authorization"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_entry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entry_tenant ON "time_entry"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_tenant ON "invoice"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
