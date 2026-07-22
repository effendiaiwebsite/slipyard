import type { NextConfig } from "next";

/**
 * Security headers (§6). CSP is intentionally strict; pdf.js (M6) may need
 * further additions when it lands — extend deliberately, never wholesale.
 *
 * M4 additions for the portal capture flow (jscanify + OpenCV.js served
 * from /public/vendor, same-origin):
 *  - 'wasm-unsafe-eval': OpenCV.js compiles its WebAssembly module at load.
 *    WASM only — plain eval() stays blocked in production.
 *  - worker-src 'self' blob:: OpenCV.js can spawn helper workers from blob
 *    URLs. Scripts themselves still come only from 'self'.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' is required by React dev tooling only — never in prod.
      process.env.NODE_ENV === "development"
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
