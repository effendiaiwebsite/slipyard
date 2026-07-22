import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { TOTP_SECRETS_FILE } from "./utils";

/** Fresh deterministic seed before every e2e run — specs may enroll MFA and
 *  mutate org state, so each run starts from the same baseline. Captured
 *  TOTP secrets go stale with the reseed, so they're cleared together. */
export default function globalSetup() {
  rmSync(TOTP_SECRETS_FILE, { force: true });
  execSync("pnpm db:seed", { stdio: "inherit" });
}
