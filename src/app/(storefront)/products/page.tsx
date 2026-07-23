import type { Metadata } from "next";
import Link from "next/link";

import { ProductFiltersForm } from "@/components/product-filters-form";
import { ProductGrid } from "@/components/product-grid";
import {
  getFilteredProductListing,
  getFilterFacets,
} from "@/lib/services/product-listing";
import {
  parseProductFilters,
  type RawSearchParams,
} from "@/lib/validation/product-filters";

// Catalog and stock change independently of deploys (AGENT.md: the database
// is the source of truth for catalog/inventory) — a statically prerendered
// build would only ever show the snapshot from the last deploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseProductFilters(await searchParams);
  const hasActiveFilters =
    filters.categorySlugs.length > 0 ||
    filters.scents.length > 0 ||
    filters.sizes.length > 0 ||
    filters.minPriceCents !== undefined ||
    filters.maxPriceCents !== undefined ||
    filters.inStockOnly;

  const [products, facets] = await Promise.all([
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
              hasActiveFilters
                ? "No products match your filters."
                : "No products match right now — check back soon."
            }
            emptyAction={
              hasActiveFilters ? (
                <Link
                  href="/products"
                  className="mt-2 inline-block text-sm underline"
                >
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
