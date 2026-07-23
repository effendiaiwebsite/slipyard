import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies browser bundles out of node_modules into public/vendor so they load
 * under the strict same-origin CSP — no CDNs (§6):
 *  - jscanify + its OpenCV.js build (M4 portal capture)
 *  - pdf.js worker (M10 e-sign placement overlay; the main library is
 *    bundled by Next, but the worker must be a same-origin URL)
 * Runs on postinstall; public/vendor is gitignored. Plain .mjs: zero deps,
 * runs before tsx exists.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

for (const file of ["jscanify.js", "opencv.js"]) {
  copyFileSync(join(root, "node_modules", "jscanify", "src", file), join(out, file));
}
copyFileSync(
  join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
  join(out, "pdf.worker.min.mjs")
);
console.log("Copied jscanify + opencv.js + pdf.worker to public/vendor/.");
