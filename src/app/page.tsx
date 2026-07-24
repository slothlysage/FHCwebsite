import Link from "next/link";

import { ProductGrid } from "@/components/product-grid";
import { getFeaturedProductListing } from "@/lib/services/product-listing";

// Catalog changes independently of deploys (AGENT.md: the database is the
// source of truth for catalog/inventory), same rationale as /products (2.2)
// and /products/[slug] (2.5) — without this the featured section would only
// ever show whatever was published at the last build.
export const dynamic = "force-dynamic";

const FEATURED_PRODUCT_LIMIT = 4;

export default async function Home() {
  const featuredProducts = await getFeaturedProductListing(
    FEATURED_PRODUCT_LIMIT,
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="py-12 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Fasthorse Creations
        </h1>
        <p className="mt-2 text-ink/70">
          Handmade candles, body butter, and self-care products.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-block rounded bg-lavender px-6 py-3 text-sm font-medium text-cream hover:bg-lavender-dark"
        >
          Shop all products
        </Link>
      </div>

      <section aria-labelledby="featured-heading" className="mt-8">
        <h2
          id="featured-heading"
          className="text-xl font-semibold tracking-tight text-ink"
        >
          Featured products
        </h2>
        <div className="mt-6">
          <ProductGrid products={featuredProducts} />
        </div>
      </section>
    </div>
  );
}
