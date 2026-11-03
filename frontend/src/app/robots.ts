import type { MetadataRoute } from "next";

// Prerendered at build time, like the X-Robots-Tag header in next.config.ts,
// so SITE_ENV is read once per deploy. Only the real production site may be
// crawled; staging and every preview tell all robots to keep out.
export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_ENV === "production") {
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
