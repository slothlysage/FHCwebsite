import { listAttributesByProductId } from "@/lib/repos/attributes";
import { listImagesByProductId } from "@/lib/repos/images";
import { getStockForVariants } from "@/lib/repos/inventory";
import { getProductBySlug } from "@/lib/repos/products";
import { listActiveVariantsByProductId } from "@/lib/repos/variants";

export type ProductDetailVariant = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  weightGrams: number;
  stock: number;
  // Sellable at zero stock (made-to-order) — the selector shows
  // "Made to order" instead of "Out of stock" when this is set.
  allowBackorder: boolean;
};

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ingredients: string | null;
  safetyInfo: string | null;
  careInfo: string | null;
  images: { url: string; altText: string }[];
  variants: ProductDetailVariant[];
  attributes: Record<string, string[]>;
};

// A single product's full detail view (2.5): the product row plus every
// active variant (with live stock), every image, and every open-ended
// attribute (scent, size, burn_time, ...) grouped by key. `null` for
// anything the storefront shouldn't be able to reach directly by slug —
// unknown, draft, archived, or soft-deleted — mirroring the listing's
// "published, non-deleted only" contract (2.2/2.3) so a guessed URL can't
// leak an unpublished product.
export async function getProductDetail(
  slug: string,
): Promise<ProductDetail | null> {
  const product = await getProductBySlug(slug);
  if (!product || product.status !== "published" || product.deletedAt) {
    return null;
  }

  const [variants, images, attributeRows] = await Promise.all([
    listActiveVariantsByProductId(product.id),
    listImagesByProductId(product.id),
    listAttributesByProductId(product.id),
  ]);

  const stockByVariant = await getStockForVariants(
    variants.map((variant) => variant.id),
  );

  const attributes: Record<string, string[]> = {};
  for (const row of attributeRows) {
    (attributes[row.key] ??= []).push(row.value);
  }

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    ingredients: product.ingredients,
    safetyInfo: product.safetyInfo,
    careInfo: product.careInfo,
    images: images.map((image) => ({
      url: image.url,
      altText: image.altText,
    })),
    variants: [...variants]
      .sort((a, b) => a.position - b.position)
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        priceCents: variant.priceCents,
        compareAtPriceCents: variant.compareAtPriceCents,
        weightGrams: variant.weightGrams,
        stock: stockByVariant.get(variant.id) ?? 0,
        allowBackorder: variant.allowBackorder,
      })),
    attributes,
  };
}
