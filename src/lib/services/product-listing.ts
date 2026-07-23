import { listFilterableAttributeValues } from "@/lib/repos/attributes";
import { listFilterableCategories } from "@/lib/repos/categories";
import { listPrimaryImagesByProductIds } from "@/lib/repos/images";
import { listPublishedProductsFiltered } from "@/lib/repos/products";
import type { ProductFilters } from "@/lib/validation/product-filters";

export type ProductListingItem = {
  id: string;
  slug: string;
  name: string;
  image: { url: string; altText: string } | null;
  priceFromCents: number | null;
  inStock: boolean;
};

export type FilterFacets = {
  categories: { slug: string; name: string }[];
  scents: string[];
  sizes: string[];
};

// Filtered/sorted, published-only listing for the storefront grid (2.2, then
// 2.3's SQL-level filter/sort). Two queries total regardless of catalog
// size — one for the filtered/sorted products (with price-from/in-stock
// already aggregated in SQL), one batch query for images — never N+1 per
// product.
export async function getFilteredProductListing(
  filters: ProductFilters,
): Promise<ProductListingItem[]> {
  const matchedProducts = await listPublishedProductsFiltered({
    categorySlugs: filters.categorySlugs,
    scents: filters.scents,
    sizes: filters.sizes,
    minPriceCents: filters.minPriceCents,
    maxPriceCents: filters.maxPriceCents,
    inStockOnly: filters.inStockOnly,
    sort: filters.sort,
  });
  if (matchedProducts.length === 0) {
    return [];
  }

  const productIds = matchedProducts.map((product) => product.id);
  const imagesByProduct = await listPrimaryImagesByProductIds(productIds);

  return matchedProducts.map((product) => {
    const image = imagesByProduct.get(product.id);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: image ? { url: image.url, altText: image.altText } : null,
      priceFromCents: product.priceFromCents,
      inStock: product.inStock,
    };
  });
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
