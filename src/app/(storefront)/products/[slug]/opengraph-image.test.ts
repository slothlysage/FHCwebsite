// @vitest-environment node
//
// Same rationale as src/app/opengraph-image.test.ts: next/og's ImageResponse
// uses `sharp` under the hood, which breaks under jsdom's Buffer realm.
// This is also an integration test against the real dev database (specs/
// 06-testing.md), same pattern as product-detail.test.ts.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { products, productVariants } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";

import Image, { alt, contentType, size } from "./opengraph-image";

describe("product opengraph-image", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  it("exports standard OG dimensions, PNG content type, and non-empty alt text", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt.length).toBeGreaterThan(0);
  });

  it("renders a valid PNG for a published product with a price", async () => {
    const product = await createProduct({
      slug: `og-image-published-${crypto.randomUUID()}`,
      name: "Balsam Fir Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: `OG-${crypto.randomUUID()}`,
      name: "8oz",
      priceCents: 2400,
      weightGrams: 226,
    });

    const response = await Image({
      params: Promise.resolve({ slug: product.slug }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("renders a fallback PNG (does not throw) for an unknown slug", async () => {
    const response = await Image({
      params: Promise.resolve({ slug: "no-such-slug-at-all" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("renders a fallback PNG for a draft product (not leaked by name)", async () => {
    const draft = await createProduct({
      slug: `og-image-draft-${crypto.randomUUID()}`,
      name: "Unreleased Product",
      status: "draft",
    });
    insertedProductIds.push(draft.id);

    const response = await Image({
      params: Promise.resolve({ slug: draft.slug }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("renders a valid PNG for a published product with no variants (no price line)", async () => {
    const product = await createProduct({
      slug: `og-image-no-variants-${crypto.randomUUID()}`,
      name: "Coming Soon Product",
      status: "published",
    });
    insertedProductIds.push(product.id);

    const response = await Image({
      params: Promise.resolve({ slug: product.slug }),
    });

    expect(response.status).toBe(200);
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
