import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // Emit a self-contained server in .next/standalone: just the app plus the
  // modules it actually imports, no node_modules tree. deploy/Dockerfile
  // copies that and nothing else, which is what keeps the runtime image small
  // and free of build tooling. Removing this breaks the Docker build.
  output: 'standalone',

  // Pin the workspace root for BOTH bundlers. A stray package-lock.json in a
  // parent directory otherwise makes Next infer the wrong root, which changes
  // file tracing and config discovery — including where PostCSS/Tailwind is
  // resolved from. `turbopack.root` covers `next build`; `outputFileTracingRoot`
  // covers the webpack path used by `next dev --webpack`.
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,

  // Baseline response headers for every route. The Content-Security-Policy
  // below carries only `frame-ancestors`: a script-src policy strict enough to
  // matter needs nonces threaded through Next's inline scripts, and a loose one
  // is theatre. Add a full CSP at your reverse proxy if your security team
  // requires it (SECURITY.md).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nothing in BROC is meant to be framed. Stops clickjacking of the
          // approve/delete buttons and of the public survey page.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Survey URLs carry their access token in the path; never send it
          // to a third-party site in a Referer header.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
