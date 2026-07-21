-- M1 RLS additions.

-- outbox: standard tenant scoping.
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY outbox_tenant ON "outbox"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- invitation: allow the join flow (no org context yet) to see EXACTLY the
-- row whose raw token it holds — the GUC carries the sha256 of the presented
-- token, so possession of the link is the credential.
CREATE POLICY invitation_by_token ON "invitation"
  USING (token_hash = NULLIF(current_setting('app.invite_token_hash', true), ''));
--> statement-breakpoint

-- stripe_event is intentionally NOT under RLS: webhook idempotency records,
-- no tenant data (event ids + types only), touched only by the webhook route.
GRANT SELECT, INSERT ON "stripe_event" TO crm_app;
