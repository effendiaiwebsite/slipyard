import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Raw db handle. ONLY these modules may import it:
 *   - src/lib/auth.ts        (better-auth adapter; auth tables are not org-scoped)
 *   - src/db/scoped.ts       (the org-scoped repository layer)
 *   - scripts/*              (setup/seed/migrate, run as admin)
 * Route handlers and services must go through scoped.ts so org_id injection
 * and RLS set_config can never be skipped. Enforced by convention + review;
 * an eslint restriction is tracked for M1.
 */

const globalForDb = globalThis as unknown as { crmPool?: Pool };

export const pool =
  globalForDb.crmPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (env.NODE_ENV !== "production") globalForDb.crmPool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export { schema };
