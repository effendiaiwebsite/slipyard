-- RLS for engagement_stage: standard tenant policy (0001_m0_rls.sql model).

ALTER TABLE "engagement_stage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement_stage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY engagement_stage_tenant ON "engagement_stage"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
