import Link from "next/link";

import type { FilterFacets } from "@/lib/services/product-listing";
import {
  filtersToSearchParams,
  PRODUCT_SORT_VALUES,
  type ProductFilters,
  type ProductSort,
} from "@/lib/validation/product-filters";

const SORT_LABELS: Record<ProductSort, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name_asc: "Name: A to Z",
};

function activeFilterCount(filters: ProductFilters): number {
  return (
    filters.categorySlugs.length +
    filters.scents.length +
    filters.sizes.length +
    (filters.minPriceCents !== undefined ? 1 : 0) +
    (filters.maxPriceCents !== undefined ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0)
  );
}

function hrefFor(
  filters: ProductFilters,
  patch: Partial<ProductFilters>,
): string {
  const query = filtersToSearchParams({ ...filters, ...patch }).toString();
  return query ? `/products?${query}` : "/products";
}

type Chip = { key: string; label: string; href: string };

function buildChips(filters: ProductFilters, facets: FilterFacets): Chip[] {
  const chips: Chip[] = [];

  for (const slug of filters.categorySlugs) {
    const name = facets.categories.find((c) => c.slug === slug)?.name ?? slug;
    chips.push({
      key: `category-${slug}`,
      label: name,
      href: hrefFor(filters, {
        categorySlugs: filters.categorySlugs.filter((s) => s !== slug),
      }),
    });
  }
  for (const scent of filters.scents) {
    chips.push({
      key: `scent-${scent}`,
      label: `Scent: ${scent}`,
      href: hrefFor(filters, {
        scents: filters.scents.filter((s) => s !== scent),
      }),
    });
  }
  for (const size of filters.sizes) {
    chips.push({
      key: `size-${size}`,
      label: `Size: ${size}`,
      href: hrefFor(filters, {
        sizes: filters.sizes.filter((s) => s !== size),
      }),
    });
  }
  if (
    filters.minPriceCents !== undefined ||
    filters.maxPriceCents !== undefined
  ) {
    const min =
      filters.minPriceCents !== undefined
        ? `$${filters.minPriceCents / 100}`
        : "any";
    const max =
      filters.maxPriceCents !== undefined
        ? `$${filters.maxPriceCents / 100}`
        : "any";
    chips.push({
      key: "price",
      label: `Price: ${min} – ${max}`,
      href: hrefFor(filters, {
        minPriceCents: undefined,
        maxPriceCents: undefined,
      }),
    });
  }
  if (filters.inStockOnly) {
    chips.push({
      key: "in-stock",
      label: "In stock only",
      href: hrefFor(filters, { inStockOnly: false }),
    });
  }

  return chips;
}

// A plain GET <form> to /products — no client JS. Checking a box or
// submitting the form is a normal browser navigation to a new query string,
// which is what makes filter state live entirely in the URL (specs/03-
// storefront.md) and keeps the read-only listing usable with JS disabled.
// The <details>/<summary> disclosure gives the mobile "Filter button with an
// active count" from the spec for free, with no JS needed to toggle it.
export function ProductFiltersForm({
  filters,
  facets,
}: {
  filters: ProductFilters;
  facets: FilterFacets;
}) {
  const chips = buildChips(filters, facets);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="mb-6 lg:mb-0 lg:w-64 lg:shrink-0">
      {chips.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Link
                href={chip.href}
                className="inline-flex items-center gap-1 rounded-full bg-sand px-3 py-1 text-sm text-ink"
              >
                {chip.label}
                <span aria-hidden="true">×</span>
                <span className="sr-only"> — remove filter</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/products" className="text-sm text-ink/70 underline">
              Clear all
            </Link>
          </li>
        </ul>
      )}

      <details className="rounded-md border border-ink/10 p-4" open>
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Filter{activeCount > 0 ? ` (${activeCount})` : ""}
        </summary>

        <form method="GET" action="/products" className="mt-4 space-y-6">
          {facets.categories.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Category</legend>
              <div className="mt-2 space-y-1">
                {facets.categories.map((category) => (
                  <label
                    key={category.slug}
                    className="flex items-center gap-2 text-sm text-ink/80"
                  >
                    <input
                      type="checkbox"
                      name="category"
                      value={category.slug}
                      defaultChecked={filters.categorySlugs.includes(
                        category.slug,
                      )}
                    />
                    {category.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {facets.scents.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Scent</legend>
              <div className="mt-2 space-y-1">
                {facets.scents.map((scent) => (
                  <label
                    key={scent}
                    className="flex items-center gap-2 text-sm text-ink/80"
                  >
                    <input
                      type="checkbox"
                      name="scent"
                      value={scent}
                      defaultChecked={filters.scents.includes(scent)}
                    />
                    {scent}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {facets.sizes.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Size</legend>
              <div className="mt-2 space-y-1">
                {facets.sizes.map((size) => (
                  <label
                    key={size}
                    className="flex items-center gap-2 text-sm text-ink/80"
                  >
                    <input
                      type="checkbox"
                      name="size"
                      value={size}
                      defaultChecked={filters.sizes.includes(size)}
                    />
                    {size}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-ink">Price</legend>
            <div className="mt-2 flex items-center gap-2">
              <label className="flex flex-col text-sm text-ink/80">
                Min
                <input
                  type="number"
                  name="minPrice"
                  min="0"
                  step="0.01"
                  defaultValue={
                    filters.minPriceCents !== undefined
                      ? filters.minPriceCents / 100
                      : undefined
                  }
                  className="w-20 rounded border border-ink/20 px-2 py-1"
                />
              </label>
              <label className="flex flex-col text-sm text-ink/80">
                Max
                <input
                  type="number"
                  name="maxPrice"
                  min="0"
                  step="0.01"
                  defaultValue={
                    filters.maxPriceCents !== undefined
                      ? filters.maxPriceCents / 100
                      : undefined
                  }
                  className="w-20 rounded border border-ink/20 px-2 py-1"
                />
              </label>
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              name="inStock"
              value="true"
              defaultChecked={filters.inStockOnly}
            />
            In stock only
          </label>

          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Sort by
            <select
              name="sort"
              defaultValue={filters.sort}
              className="rounded border border-ink/20 px-2 py-1"
            >
              {PRODUCT_SORT_VALUES.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="rounded-md bg-lavender px-4 py-2 text-sm font-medium text-cream"
          >
            Apply filters
          </button>
        </form>
      </details>
    </div>
  );
}
