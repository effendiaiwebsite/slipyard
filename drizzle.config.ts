import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run as the DB owner (RLS policies, roles, grants).
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
