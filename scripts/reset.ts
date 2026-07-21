import "dotenv/config";
import { execSync } from "node:child_process";
import { adminUrl, APP_DB_NAME, withClient } from "./db-lib";

/**
 * pnpm db:reset — drop everything, re-migrate, re-seed. Dev/test only.
 */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:reset is disabled in production");
  }
  await withClient(adminUrl(APP_DB_NAME), async (c) => {
    await c.query("drop schema if exists public cascade");
    await c.query("drop schema if exists drizzle cascade");
    await c.query("create schema public");
  });
  console.log("Schema dropped. Re-migrating...");
  execSync("pnpm db:migrate", { stdio: "inherit" });
  execSync("pnpm db:seed", { stdio: "inherit" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
