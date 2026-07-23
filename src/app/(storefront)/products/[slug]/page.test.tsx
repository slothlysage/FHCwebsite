import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import {
  productAttributes,
  productImages,
  products,
  productVariants,
} from "@/lib/db/schema";
import { replaceProductImages } from "@/lib/repos/images";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { setProductAttribute } from "@/lib/repos/attributes";
import ProductDetailPage, { generateMetadata } from "./page";

// Integration test against a real Postgres (specs/06-testing.md) — an async
// Server Component, invoked and awaited directly rather than passed to
// render() as JSX, same pattern as products/page.test.tsx.

function withParams(
  params: { slug: string },
  searchParams: Record<string, string> = {},
) {
  return ProductDetailPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("ProductDetailPage", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db
        .delete(productImages)
        .where(eq(productImages.productId, productId));
      await db
        .delete(productAttributes)
        .where(eq(productAttributes.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  it("renders the product's name, description, and selected variant's price", async () => {
    const product = await createProduct({
      slug: "test-detail-page-full",
      name: "Lavender Candle",
      description: "A calming candle.",
      ingredients: "Soy wax, lavender oil",
      status: "published",
    });
    insertedProductIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "test-detail-page-full-sku",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      position: 0,
    });
    await replaceProductImages(product.id, [
      {
        url: "https://example.com/candle.jpg",
        altText: "Lavender candle",
        position: 0,
        width: 0,
        height: 0,
      },
    ]);

    render(await withParams({ slug: "test-detail-page-full" }));

    expect(
      screen.getByRole("heading", { name: /lavender candle/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("A calming candle.")).toBeInTheDocument();
    expect(screen.getByText("Soy wax, lavender oil")).toBeInTheDocument();
    expect(screen.getByText("$24.00")).toBeInTheDocument();
    expect(screen.getByAltText("Lavender candle")).toBeInTheDocument();
  });

  it("selects the variant named by the ?variant= query param", async () => {
    const product = await createProduct({
      slug: "test-detail-page-variant-param",
      name: "Multi Variant Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "test-detail-page-variant-param-a",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      position: 0,
    });
    await createVariant({
      productId: product.id,
      sku: "test-detail-page-variant-param-b",
      name: "16oz",
      priceCents: 4000,
      weightGrams: 454,
      position: 1,
    });

    render(
      await withParams(
        { slug: "test-detail-page-variant-param" },
        { variant: "test-detail-page-variant-param-b" },
      ),
    );

    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });

  it("falls back to the first variant when the ?variant= param doesn't match any SKU", async () => {
    const product = await createProduct({
      slug: "test-detail-page-variant-unknown",
      name: "Unknown Variant Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "test-detail-page-variant-unknown-a",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      position: 0,
    });

    render(
      await withParams(
        { slug: "test-detail-page-variant-unknown" },
        { variant: "no-such-sku" },
      ),
    );

    expect(screen.getByText("$24.00")).toBeInTheDocument();
  });

  it("shows a burn-time attribute when the product has one", async () => {
    const product = await createProduct({
      slug: "test-detail-page-burn-time",
      name: "Burn Time Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "test-detail-page-burn-time-sku",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      position: 0,
    });
    await setProductAttribute(product.id, "burn_time", "40 hours");

    render(await withParams({ slug: "test-detail-page-burn-time" }));

    expect(screen.getByText("40 hours")).toBeInTheDocument();
  });

  it("rejects (404s) for an unknown slug", async () => {
    await expect(
      withParams({ slug: "no-such-slug-anywhere" }),
    ).rejects.toThrow();
  });

  it("rejects (404s) for a draft product, even by its real slug", async () => {
    const product = await createProduct({
      slug: "test-detail-page-draft",
      name: "Draft Candle",
      status: "draft",
    });
    insertedProductIds.push(product.id);

    await expect(
      withParams({ slug: "test-detail-page-draft" }),
    ).rejects.toThrow();
  });
});

describe("ProductDetailPage generateMetadata", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  it("uses the product name as the title and a canonical URL, with a truncated description", async () => {
    const product = await createProduct({
      slug: "test-detail-page-metadata",
      name: "Lavender Candle",
      description: "A calming candle.",
      status: "published",
    });
    insertedProductIds.push(product.id);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "test-detail-page-metadata" }),
    });

    expect(metadata.title).toBe("Lavender Candle");
    expect(metadata.description).toBe("A calming candle.");
    expect(metadata.alternates?.canonical).toBe(
      "/products/test-detail-page-metadata",
    );
  });

  it("returns empty metadata for an unknown slug instead of throwing", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "no-such-slug-anywhere" }),
    });
    expect(metadata).toEqual({});
  });
});
