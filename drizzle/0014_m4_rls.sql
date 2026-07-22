-- M4 RLS: portal_token gets the standard tenant policy. No GUC-as-credential
-- pre-org policy is needed (ADR-0009): the magic-link JWT itself embeds the
-- org_id claim, the signature is the credential, and the app arms app.org_id
-- from the verified claim BEFORE looking the row up by hash.

ALTER TABLE "portal_token" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "portal_token" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY portal_token_tenant ON "portal_token"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
