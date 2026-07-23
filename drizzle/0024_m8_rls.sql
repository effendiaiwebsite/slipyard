-- M8 RLS: ai_interaction gets the standard tenant policy, keyed on the
-- transaction-local app.org_id GUC (ADR-0002). Only ever touched from the
-- authenticated staff session — no portal/webhook path, so no
-- GUC-as-credential policies are needed.

ALTER TABLE "ai_interaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_interaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_interaction_tenant ON "ai_interaction"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
