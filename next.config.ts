import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // --- ADD THIS LINE ---
  output: 'standalone',
  // ---------------------

  /* other config options here */
  // Type errors now fail the build. They used to be ignored, which is how a
  // types file describing a schema that no longer existed survived in the
  // repository, and why so much of the app was cast through `any`.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Lint warnings are still not worth failing a deployment over; `npm run
  // lint` reports them.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // The version banner tells an attacker which advisories to try.
  poweredByHeader: false,

  /**
   * Security headers, applied to every response.
   *
   * The CSP still allows inline scripts and styles, which Next's hydration
   * bootstrap and Tailwind need without a nonce. It is worth tightening
   * later; what it buys today is that no script, frame or form from
   * anywhere else can be injected into a page, and the portal cannot be
   * framed for a clickjacking attack on the approve buttons.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Served over HTTPS at the institute; harmless over plain HTTP.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;