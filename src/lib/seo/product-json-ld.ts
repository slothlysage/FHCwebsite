import type { ProductDetail } from "@/lib/services/product-detail";

export type ProductJsonLd = {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description?: string;
  image: string[];
  sku: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
    availability: string;
    url: string;
  };
};

function availabilityFor(variant: ProductDetail["variants"][number]): string {
  if (variant.stock > 0) return "https://schema.org/InStock";
  if (variant.allowBackorder) return "https://schema.org/BackOrder";
  return "https://schema.org/OutOfStock";
}

// Product + Offer JSON-LD for one product-detail page (2.6b). Deliberately
// omits the `?variant=` query string from the Offer URL, same as
// generateMetadata's canonical (2.6a) — the variant selector is UI state on
// one resource, not a distinct crawlable page.
// Returns null when the required `image`/`offers` fields can't be populated
// (no images, or no variants at all) rather than emitting JSON-LD that would
// fail schema.org's required-field validation.
export function buildProductJsonLd(
  detail: ProductDetail,
  selectedSku: string,
  siteUrl: string,
): ProductJsonLd | null {
  if (detail.images.length === 0) return null;

  const variant =
    detail.variants.find((v) => v.sku === selectedSku) ?? detail.variants[0];
  if (!variant) return null;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.name,
    ...(detail.description !== null && { description: detail.description }),
    image: detail.images.map((image) => image.url),
    sku: variant.sku,
    offers: {
      "@type": "Offer",
      price: (variant.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: availabilityFor(variant),
      url: `${siteUrl}/products/${detail.slug}`,
    },
  };
}
