-- M3 RLS: document + checklist_item get the standard tenant policy, same
-- shape as the M2 tables (see 0001_m0_rls.sql for the model).

ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "checklist_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "checklist_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY document_tenant ON "document"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY checklist_item_tenant ON "checklist_item"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
