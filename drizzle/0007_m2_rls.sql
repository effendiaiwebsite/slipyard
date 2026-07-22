-- M2 RLS: client-hub tables get the standard tenant policy, same shape as
-- org/invitation/outbox (see 0001_m0_rls.sql for the model).

ALTER TABLE "client" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "client" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "household" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "household" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "client_note" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "client_note" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY client_tenant ON "client"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY household_tenant ON "household"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY engagement_tenant ON "engagement"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY client_note_tenant ON "client_note"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY contact_log_tenant ON "contact_log"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
