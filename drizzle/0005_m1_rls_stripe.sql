-- Stripe webhook path: the handler must resolve an org from a customer id
-- carried in a SIGNATURE-VERIFIED event, before any user/org context exists.
-- Mirrors the invitation_by_token pattern: the GUC value is the credential,
-- and it exposes exactly one org.
CREATE POLICY org_by_stripe_customer ON "org"
  USING (
    stripe_customer_id IS NOT NULL
    AND stripe_customer_id = NULLIF(current_setting('app.stripe_customer_id', true), '')
  );
