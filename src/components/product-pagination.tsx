import Link from "next/link";

import {
  filtersToSearchParams,
  type ProductFilters,
} from "@/lib/validation/product-filters";

function hrefForPage(filters: ProductFilters, page: number): string {
  const query = filtersToSearchParams({ ...filters, page }).toString();
  return query ? `/products?${query}` : "/products";
}

// Prev/Next pagination for the products listing (fix_plan 2.4). Plain links
// to a new `/products?...` URL — no client JS — so page state lives in the
// URL the same way filter/sort state does (specs/03-storefront.md), and
// every link preserves the currently active filters via
// `filtersToSearchParams`.
export function ProductPagination({
  filters,
  hasNextPage,
}: {
  filters: ProductFilters;
  hasNextPage: boolean;
}) {
  const { page } = filters;
  const hasPreviousPage = page > 1;

  if (!hasPreviousPage && !hasNextPage) {
    return null;
  }

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex items-center justify-between text-sm"
    >
      {hasPreviousPage ? (
        <Link href={hrefForPage(filters, page - 1)} className="underline">
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink/70">Page {page}</span>
      {hasNextPage ? (
        <Link href={hrefForPage(filters, page + 1)} className="underline">
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
