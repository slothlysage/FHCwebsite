import { listFilterableAttributeValues } from "@/lib/repos/attributes";
import { listFilterableCategories } from "@/lib/repos/categories";
import { listPrimaryImagesByProductIds } from "@/lib/repos/images";
import { listPublishedProductsFiltered } from "@/lib/repos/products";
import {
  PRODUCTS_PAGE_SIZE,
  type ProductFilters,
} from "@/lib/validation/product-filters";

export type ProductListingItem = {
  id: string;
  slug: string;
  name: string;
  image: { url: string; altText: string } | null;
  priceFromCents: number | null;
  inStock: boolean;
  // Sellable even at zero stock (made-to-order) — drives the card's
  // "Made to order" vs "Out of stock" label.
  purchasable: boolean;
};

export type ProductListingPage = {
  items: ProductListingItem[];
  hasNextPage: boolean;
};

export type FilterFacets = {
  categories: { slug: string; name: string }[];
  scents: string[];
  sizes: string[];
};

// Filtered/sorted, published-only listing for the storefront grid (2.2, then
// 2.3's SQL-level filter/sort, then 2.4's pagination). Two queries total
// regardless of catalog size — one for the filtered/sorted/paginated
// products (with price-from/in-stock already aggregated in SQL), one batch
// query for images — never N+1 per product.
//
// Pagination requests one row past PRODUCTS_PAGE_SIZE from the repo (limit
// PRODUCTS_PAGE_SIZE + 1, offset from the real page size) and slices it off
// here — that extra row is what tells us `hasNextPage` without a second
// COUNT query. The repo's `limit`/`offset` are raw, not a `page` number,
// specifically because this peek needs a limit one larger than the offset
// stride — the two can't be derived from a single "page size" value. The
// repo's ORDER BY is tie-broken on id, so this slice is stable across page
// boundaries even when sorting on a non-unique column (fix_plan 2.4).
export async function getFilteredProductListing(
  filters: ProductFilters,
): Promise<ProductListingPage> {
  const matchedProducts = await listPublishedProductsFiltered({
    categorySlugs: filters.categorySlugs,
    scents: filters.scents,
    sizes: filters.sizes,
    minPriceCents: filters.minPriceCents,
    maxPriceCents: filters.maxPriceCents,
    inStockOnly: filters.inStockOnly,
    sort: filters.sort,
    limit: PRODUCTS_PAGE_SIZE + 1,
    offset: (filters.page - 1) * PRODUCTS_PAGE_SIZE,
  });
  const hasNextPage = matchedProducts.length > PRODUCTS_PAGE_SIZE;
  const pageProducts = matchedProducts.slice(0, PRODUCTS_PAGE_SIZE);
  if (pageProducts.length === 0) {
    return { items: [], hasNextPage };
  }

  const productIds = pageProducts.map((product) => product.id);
  const imagesByProduct = await listPrimaryImagesByProductIds(productIds);

  const items = pageProducts.map((product) => {
    const image = imagesByProduct.get(product.id);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: image ? { url: image.url, altText: image.altText } : null,
      priceFromCents: product.priceFromCents,
      inStock: product.inStock,
      purchasable: product.purchasable,
    };
  });
  return { items, hasNextPage };
}

// The available filter options for the storefront's facet UI — every
// category/scent/size with at least one live published product behind it.
export async function getFilterFacets(): Promise<FilterFacets> {
  const [categories, scents, sizes] = await Promise.all([
    listFilterableCategories(),
    listFilterableAttributeValues("scent"),
    listFilterableAttributeValues("size"),
  ]);

  return {
    categories: categories.map((category) => ({
      slug: category.slug,
      name: category.name,
    })),
    scents,
    sizes,
  };
}
