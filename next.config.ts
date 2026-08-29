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
};

export default nextConfig;