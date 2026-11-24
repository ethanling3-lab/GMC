import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  experimental: {
    // Middleware now covers /api/admin, and uploads there go up to 20 MB.
    proxyClientMaxBodySize: "25mb",
  },
  // Pin the turbopack workspace root to this project (there's a package-lock.json
  // at the parent directory for Puppeteer / design-tool installs that Next would
  // otherwise pick up as the root).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
