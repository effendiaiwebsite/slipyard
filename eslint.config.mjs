import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prior UI-only mock kept for visual reference — never linted, never imported.
    "design-reference/**",
    // Vendored browser libs (jscanify/OpenCV.js) copied on postinstall.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
