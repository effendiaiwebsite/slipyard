import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * One-shot dev setup: `pnpm run setup`
 *   1. Creates .env from .env.example if missing (generates secrets, points
 *      DATABASE_URL at local dev Postgres).
 *   2. Creates the app database + non-superuser crm_app role.
 *   3. Runs migrations + grants.
 *   4. Seeds deterministic fictional data.
 *
 * Requires a reachable Postgres: `docker compose up -d postgres`, or any local
 * install with a postgres/postgres superuser (override via DATABASE_ADMIN_URL).
 */
async function main() {
  const root = process.cwd();
  const envPath = path.join(root, ".env");

  if (!fs.existsSync(envPath)) {
    let content = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    const secret = () => randomBytes(32).toString("base64");
    content = content
      .replace(/^DATABASE_URL=$/m, "DATABASE_URL=postgresql://crm_app:crm_app_dev_password@localhost:5432/accountant_crm")
      .replace(/^DATABASE_ADMIN_URL=$/m, "DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/accountant_crm")
      .replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${secret()}`)
      .replace(/^FIELD_ENCRYPTION_KEY=$/m, `FIELD_ENCRYPTION_KEY=${secret()}`);
    fs.writeFileSync(envPath, content);
    console.log("Created .env with generated secrets and local dev DB URLs.");
  } else {
    console.log(".env already exists — leaving it untouched.");
  }

  // Load the (possibly new) .env before touching the DB.
  const dotenv = await import("dotenv");
  dotenv.config({ path: envPath, override: false });

  const { ensureDatabaseAndRole } = await import("./db-lib");
  await ensureDatabaseAndRole();

  execSync("pnpm db:migrate", { stdio: "inherit" });
  execSync("pnpm db:seed", { stdio: "inherit" });

  console.log("\nSetup complete. Run `pnpm dev` and open http://localhost:3000");
  console.log("Seed logins are printed by the seed step above (dev only).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
