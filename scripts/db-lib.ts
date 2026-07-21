import "dotenv/config";
import { Client } from "pg";

/**
 * Shared helpers for setup/migrate/reset scripts. These run as the DB owner
 * (DATABASE_ADMIN_URL), never as the app role.
 */

export const APP_DB_NAME = dbNameFromUrl(appUrl());
export const APP_ROLE = "crm_app";
// Dev-only default; production sets its own password via DATABASE_URL.
export const APP_ROLE_DEV_PASSWORD = "crm_app_dev_password";

export function adminUrl(database?: string): string {
  const raw = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL (or DATABASE_ADMIN_URL) is required");
  const u = new URL(raw);
  if (database) u.pathname = `/${database}`;
  return u.toString();
}

export function appUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  return raw;
}

function dbNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, "") || "accountant_crm";
}

export async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Create the app database and non-superuser app role if they don't exist. */
export async function ensureDatabaseAndRole() {
  await withClient(adminUrl("postgres"), async (c) => {
    const role = await c.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
    if (role.rowCount === 0) {
      await c.query(
        `create role ${APP_ROLE} login password '${APP_ROLE_DEV_PASSWORD}' nosuperuser nocreatedb nocreaterole`
      );
      console.log(`Created role ${APP_ROLE}`);
    }
    const db = await c.query("select 1 from pg_database where datname = $1", [APP_DB_NAME]);
    if (db.rowCount === 0) {
      await c.query(`create database ${quoteIdent(APP_DB_NAME)}`);
      console.log(`Created database ${APP_DB_NAME}`);
    }
  });
}

/**
 * Idempotent grants for the app role. RLS enablement + policies live in the
 * generated migrations; this covers privileges (which drizzle doesn't manage).
 */
export async function applyGrants() {
  await withClient(adminUrl(APP_DB_NAME), async (c) => {
    await c.query(`grant usage on schema public to ${APP_ROLE}`);
    await c.query(
      `grant select, insert, update, delete on all tables in schema public to ${APP_ROLE}`
    );
    await c.query(`grant usage, select on all sequences in schema public to ${APP_ROLE}`);
    await c.query(
      `alter default privileges in schema public grant select, insert, update, delete on tables to ${APP_ROLE}`
    );
    await c.query(
      `alter default privileges in schema public grant usage, select on sequences to ${APP_ROLE}`
    );
    // audit_log is append-only for the app role; re-apply after the broad grant.
    await c.query(
      `do $$ begin
         if exists (select 1 from information_schema.tables where table_name = 'audit_log') then
           revoke update, delete on audit_log from ${APP_ROLE};
         end if;
       end $$`
    );
  });
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return name;
}
