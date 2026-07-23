import { describe, expect, it } from "vitest";

import type { ProductDetail } from "@/lib/services/product-detail";
import { buildProductJsonLd } from "./product-json-ld";

function baseDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "prod-1",
    slug: "lavender-candle",
    name: "Lavender Candle",
    description: "A calming candle.",
    ingredients: null,
    safetyInfo: null,
    careInfo: null,
    images: [{ url: "https://example.com/candle.jpg", altText: "Lavender" }],
    variants: [
      {
        id: "var-1",
        sku: "LAV-8OZ",
        name: "8oz",
        priceCents: 2400,
        compareAtPriceCents: null,
        weightGrams: 227,
        stock: 3,
        allowBackorder: false,
      },
    ],
    attributes: {},
    ...overrides,
  };
}

describe("buildProductJsonLd", () => {
  it("builds a valid Product + Offer graph for an in-stock variant", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail(),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd).not.toBeNull();
    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Lavender Candle",
      description: "A calming candle.",
      image: ["https://example.com/candle.jpg"],
      sku: "LAV-8OZ",
      offers: {
        "@type": "Offer",
        price: "24.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: "https://fhc.example/products/lavender-candle",
      },
    });

    // Round-trips through JSON.stringify/parse, i.e. it's valid JSON with no
    // undefined-valued keys silently smuggled through.
    expect(() => JSON.parse(JSON.stringify(jsonLd))).not.toThrow();
  });

  it("marks a zero-stock, backorderable variant as BackOrder, not OutOfStock", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail({
        variants: [
          {
            id: "var-1",
            sku: "LAV-8OZ",
            name: "8oz",
            priceCents: 2400,
            compareAtPriceCents: null,
            weightGrams: 227,
            stock: 0,
            allowBackorder: true,
          },
        ],
      }),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd?.offers.availability).toBe("https://schema.org/BackOrder");
  });

  it("marks a zero-stock, non-backorderable variant as OutOfStock", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail({
        variants: [
          {
            id: "var-1",
            sku: "LAV-8OZ",
            name: "8oz",
            priceCents: 2400,
            compareAtPriceCents: null,
            weightGrams: 227,
            stock: 0,
            allowBackorder: false,
          },
        ],
      }),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd?.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("falls back to the first variant when selectedSku matches none", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail(),
      "no-such-sku",
      "https://fhc.example",
    );

    expect(jsonLd?.sku).toBe("LAV-8OZ");
    expect(jsonLd?.offers.price).toBe("24.00");
  });

  it("omits description when the product has none, rather than emitting null", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail({ description: null }),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd).not.toHaveProperty("description");
  });

  it("returns null when the product has no images (image is a required field)", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail({ images: [] }),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd).toBeNull();
  });

  it("returns null when the product has no purchasable variants", () => {
    const jsonLd = buildProductJsonLd(
      baseDetail({ variants: [] }),
      "LAV-8OZ",
      "https://fhc.example",
    );

    expect(jsonLd).toBeNull();
  });
});
