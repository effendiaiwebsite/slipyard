-- pg-boss runs `CREATE SCHEMA IF NOT EXISTS pgboss` at start() and Postgres
-- checks the privilege even when the schema already exists (0016 created it,
-- owned by crm_app). Grant database CREATE so the app role passes that check;
-- it's schema-creation only — no table/data rights come with it.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO crm_app', current_database());
END
$$;
