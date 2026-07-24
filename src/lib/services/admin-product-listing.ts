import { listProducts } from "@/lib/repos/products";
import { listVariantsByProductIds } from "@/lib/repos/variants";
import type { AdminProductFilters } from "@/lib/validation/admin-product-filters";

export type AdminProductListItem = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  skus: string[];
  updatedAt: Date;
};

// The admin Products screen's read-only list (fix_plan 4.3b): every
// draft/published/archived product matching the search/status filter, each
// with its variants' SKUs attached (a product can have several, and the
// owner may be searching by SKU rather than name). Two queries total,
// regardless of catalog size — one for the filtered products, one batch
// lookup for their variants — same "products query then one batch related-
// data query" shape as the storefront's getFilteredProductListing.
export async function listAdminProducts(
  filters: AdminProductFilters,
): Promise<AdminProductListItem[]> {
  const matchedProducts = await listProducts({
    status: filters.status,
    search: filters.search,
  });
  if (matchedProducts.length === 0) {
    return [];
  }

  const productIds = matchedProducts.map((product) => product.id);
  const variantsByProduct = await listVariantsByProductIds(productIds);

  return matchedProducts.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    status: product.status,
    skus: (variantsByProduct.get(product.id) ?? []).map(
      (variant) => variant.sku,
    ),
    updatedAt: product.updatedAt,
  }));
}
