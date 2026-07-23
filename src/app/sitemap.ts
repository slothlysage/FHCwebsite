import type { MetadataRoute } from "next";

import { env } from "@/lib/env";
import { listProducts } from "@/lib/repos/products";

// Catalog changes independently of deploys (AGENT.md: the database is the
// source of truth for catalog/inventory) — same rationale as /products
// (2.2) and /products/[slug] (2.5): a statically prerendered sitemap would
// only ever list the products published as of the last build.
export const dynamic = "force-dynamic";

// Static routes plus one entry per published, non-deleted product — no query
// strings, since a filtered/paginated /products?... self-canonicalizes to
// the bare listing (fix_plan 2.6a) and isn't a distinct indexable resource.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const publishedProducts = await listProducts({ status: "published" });

  return [
    { url: siteUrl },
    { url: `${siteUrl}/products` },
    ...publishedProducts.map((product) => ({
      url: `${siteUrl}/products/${product.slug}`,
      lastModified: product.updatedAt,
    })),
  ];
}
