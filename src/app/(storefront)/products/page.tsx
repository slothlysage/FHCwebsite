import type { Metadata } from "next";
import Link from "next/link";

import { ProductFiltersForm } from "@/components/product-filters-form";
import { ProductGrid } from "@/components/product-grid";
import { ProductPagination } from "@/components/product-pagination";
import {
  getFilteredProductListing,
  getFilterFacets,
} from "@/lib/services/product-listing";
import {
  hasActiveFilters,
  parseProductFilters,
  type RawSearchParams,
} from "@/lib/validation/product-filters";

// Catalog and stock change independently of deploys (AGENT.md: the database
// is the source of truth for catalog/inventory) — a statically prerendered
// build would only ever show the snapshot from the last deploy.
export const dynamic = "force-dynamic";

// A filtered/sorted/paginated /products?... is still the same logical
// resource as the plain listing, so it always self-canonicalizes to the
// unfiltered path (fix_plan 2.6a) rather than growing one canonical per query
// string. Filtered requests additionally get `noindex` — otherwise every
// facet combination is a crawlable near-duplicate of the same page, which is
// pure crawl-budget waste with no ranking benefit.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const filters = parseProductFilters(await searchParams);
  return {
    title: "Shop",
    description: "Shop handmade candles, body butter, and self-care products.",
    alternates: { canonical: "/products" },
    ...(hasActiveFilters(filters)
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseProductFilters(await searchParams);
  const filtersActive = hasActiveFilters(filters);

  const [{ items: products, hasNextPage }, facets] = await Promise.all([
    getFilteredProductListing(filters),
    getFilterFacets(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Shop</h1>
      <div className="mt-8 lg:flex lg:items-start lg:gap-8">
        <ProductFiltersForm filters={filters} facets={facets} />
        <div className="flex-1">
          <ProductGrid
            products={products}
            emptyMessage={
              filtersActive
                ? "No products match your filters."
                : "No products match right now — check back soon."
            }
            emptyAction={
              filtersActive ? (
                <Link
                  href="/products"
                  className="mt-2 inline-block text-sm underline"
                >
                  Clear filters
                </Link>
              ) : undefined
            }
          />
          <ProductPagination filters={filters} hasNextPage={hasNextPage} />
        </div>
      </div>
    </div>
  );
}
