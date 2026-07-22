import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the jscanify browser bundle (+ its OpenCV.js build) out of
 * node_modules into public/vendor so the portal capture flow can load it
 * under the strict same-origin CSP — no CDNs (§6). Runs on postinstall;
 * public/vendor is gitignored. Plain .mjs: zero deps, runs before tsx exists.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

for (const file of ["jscanify.js", "opencv.js"]) {
  copyFileSync(join(root, "node_modules", "jscanify", "src", file), join(out, file));
}
console.log("Copied jscanify + opencv.js to public/vendor/.");
