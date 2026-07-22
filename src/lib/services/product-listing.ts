import { getStockForVariants } from "@/lib/repos/inventory";
import { listPrimaryImagesByProductIds } from "@/lib/repos/images";
import { listProducts } from "@/lib/repos/products";
import { listActiveVariantsByProductIds } from "@/lib/repos/variants";

export type ProductListingItem = {
  id: string;
  slug: string;
  name: string;
  image: { url: string; altText: string } | null;
  priceFromCents: number | null;
  inStock: boolean;
};

// Newest-first, published-only listing for the storefront grid (2.2).
// Three queries total regardless of catalog size — one for products, one
// batch query each for variants/images, plus a batch stock lookup — never
// N+1 per product. 2.3 will extend this with SQL-level filter/sort/pagination
// rather than replacing the shape.
export async function getPublishedProductListing(): Promise<
  ProductListingItem[]
> {
  const publishedProducts = await listProducts({ status: "published" });
  if (publishedProducts.length === 0) {
    return [];
  }

  const productIds = publishedProducts.map((product) => product.id);
  const [variantsByProduct, imagesByProduct] = await Promise.all([
    listActiveVariantsByProductIds(productIds),
    listPrimaryImagesByProductIds(productIds),
  ]);

  const allActiveVariantIds = [...variantsByProduct.values()]
    .flat()
    .map((variant) => variant.id);
  const stockByVariant = await getStockForVariants(allActiveVariantIds);

  return publishedProducts.map((product) => {
    const variants = variantsByProduct.get(product.id) ?? [];
    const image = imagesByProduct.get(product.id);
    const priceFromCents =
      variants.length > 0
        ? Math.min(...variants.map((variant) => variant.priceCents))
        : null;
    const inStock = variants.some(
      (variant) => (stockByVariant.get(variant.id) ?? 0) > 0,
    );

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: image ? { url: image.url, altText: image.altText } : null,
      priceFromCents,
      inStock,
    };
  });
}
