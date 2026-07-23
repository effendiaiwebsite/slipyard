-- M6 RLS: signature_request gets the standard tenant policy, keyed on the
-- transaction-local app.org_id GUC (ADR-0002). Remote signing arms app.org_id
-- from the verified portal-session JWT (ADR-0026), exactly as portal_token /
-- portal uploads do — no GUC-as-credential pre-org policy needed.

ALTER TABLE "signature_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY signature_request_tenant ON "signature_request"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
