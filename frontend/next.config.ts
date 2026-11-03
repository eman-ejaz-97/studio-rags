import path from "node:path";
import type { NextConfig } from "next";
import { apiOrigin } from "./src/lib/api-origin";
import { pinnedRoots } from "./src/lib/build-roots";

// This file is evaluated at build time, and the output keeps the result: the
// rewrite destination and the headers below are fixed when `next build` runs.
// Changing API_ORIGIN or SITE_ENV therefore needs a rebuild (on Vercel, a
// redeploy), not just a restart.
const isProductionSite = process.env.SITE_ENV === "production";

// Pinned to frontend/ everywhere except Vercel: see build-roots.ts for why.
const frontendRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone) for the Docker image. Vercel
  // ignores this and uses its own output.
  output: "standalone",
  ...pinnedRoots(frontendRoot),

  poweredByHeader: false,

  async rewrites() {
    return [
      {
        // Same-origin API. The frontend (*.vercel.app) and the API
        // (*.onrender.com) are different sites, so a SameSite=Lax auth cookie
        // set by the API would never travel with requests from the page. The
        // browser instead calls /api/v1 on this origin and the server proxies
        // it, so the cookie belongs to this origin. The path is kept intact
        // so the refresh cookie's Path=/api/v1/auth still matches.
        source: "/api/v1/:path*",
        destination: `${apiOrigin()}/api/v1/:path*`,
      },
    ];
  },

  async headers() {
    if (isProductionSite) return [];
    return [
      {
        // Every non-production deploy (staging, Vercel previews, local) tells
        // search engines to stay away, so a test site never outranks or
        // duplicates the real one. robots.ts says the same to polite crawlers;
        // this header also covers pages a crawler reaches by a direct link.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
