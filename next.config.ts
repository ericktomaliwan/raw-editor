import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy. The app is fully self-contained (no third-party
 * scripts, fonts, images or API calls), so everything is limited to our own
 * origin. `connect-src 'self'` also backs the "nothing is uploaded" promise:
 * page code cannot send a photo to another host.
 *
 * Page-view analytics (@vercel/analytics) stays inside that rule in
 * production: the script and its beacons are served from this origin under
 * /_vercel/insights/*. Only the development build pulls a debug script from
 * another host, which is allowed below in development only.
 *
 * `script-src` needs `'unsafe-inline'` because the page is statically
 * prerendered: Next's inline bootstrap scripts and the drag/drop guard in
 * app/layout.tsx can't carry a per-request nonce. React's dev tooling needs
 * `'unsafe-eval'`, in development only.
 */
const ANALYTICS_DEBUG_HOST = "https://va.vercel-scripts.com";

function contentSecurityPolicy(scriptSrc: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // `ws:` is for the dev server's hot-reload socket.
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const PAGE_CSP = contentSecurityPolicy(
  `'self' 'unsafe-inline'${isDev ? ` 'unsafe-eval' ${ANALYTICS_DEBUG_HOST}` : ""}`,
);

/**
 * The RAW decoder worker runs under the policy served with its own file, not
 * the page's. It compiles WebAssembly and its glue code builds call wrappers
 * with `new Function`, so it needs `'unsafe-eval'`. Scoping that to /libraw
 * keeps eval out of the page itself.
 */
const DECODER_CSP = contentSecurityPolicy("'self' 'unsafe-eval'");

/**
 * Same idea for the JPEG, PNG and WebP encoder workers under /mozjpeg, /oxipng and /webp.
 * Their glue code needs no eval, so the narrower `'wasm-unsafe-eval'` (compile
 * WebAssembly, nothing else) is enough.
 */
const ENCODER_CSP = contentSecurityPolicy("'self' 'wasm-unsafe-eval'");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // The RAW decoder (libraw-wasm) uses threads => SharedArrayBuffer, which
          // browsers only expose to cross-origin-isolated pages.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Content-Security-Policy", value: PAGE_CSP },
          // Never let the browser guess a content type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No framing by other sites (older browsers; CSP frame-ancestors covers the rest).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The editor uses none of these device features.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        // Listed after the catch-all so these policies win for the worker files.
        source: "/mozjpeg/:path*",
        headers: [{ key: "Content-Security-Policy", value: ENCODER_CSP }],
      },
      {
        source: "/oxipng/:path*",
        headers: [{ key: "Content-Security-Policy", value: ENCODER_CSP }],
      },
      {
        source: "/webp/:path*",
        headers: [{ key: "Content-Security-Policy", value: ENCODER_CSP }],
      },
      {
        source: "/libraw/:path*",
        headers: [{ key: "Content-Security-Policy", value: DECODER_CSP }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
