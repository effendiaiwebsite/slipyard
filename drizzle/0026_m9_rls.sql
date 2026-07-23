-- M9 RLS: the three import tables get the standard tenant policy, keyed on the
-- transaction-local app.org_id GUC (ADR-0002). Only ever touched from the
-- authenticated staff session (import.manage — owner/admin), so no
-- GUC-as-credential policies are needed.

ALTER TABLE "import_batch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_batch" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_batch_tenant ON "import_batch"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "import_staging_row" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_staging_row" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_staging_row_tenant ON "import_staging_row"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "import_mapping_template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_mapping_template" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_mapping_template_tenant ON "import_mapping_template"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
