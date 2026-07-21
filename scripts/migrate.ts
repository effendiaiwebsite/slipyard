import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { adminUrl, APP_DB_NAME, applyGrants } from "./db-lib";

async function main() {
  const pool = new Pool({ connectionString: adminUrl(APP_DB_NAME) });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  await applyGrants();
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
