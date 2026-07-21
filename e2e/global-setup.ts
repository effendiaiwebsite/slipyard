import { execSync } from "node:child_process";

/** Fresh deterministic seed before every e2e run — specs may enroll MFA and
 *  mutate org state, so each run starts from the same baseline. */
export default function globalSetup() {
  execSync("pnpm db:seed", { stdio: "inherit" });
}
