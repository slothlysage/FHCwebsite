import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  return {
    rules: {
      userAgent: "*",
      disallow: ["/admin", "/api"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
