import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  inventoryMovements,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { recordMovement } from "@/lib/repos/inventory";
import { replaceProductImages } from "@/lib/repos/images";
import { createProduct } from "@/lib/repos/products";
import { createVariant, deactivateVariant } from "@/lib/repos/variants";
import { getPublishedProductListing } from "@/lib/services/product-listing";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("getPublishedProductListing", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      for (const variant of variants) {
        await db
          .delete(inventoryMovements)
          .where(eq(inventoryMovements.variantId, variant.id));
      }
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db
        .delete(productImages)
        .where(eq(productImages.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeProduct(
    slug: string,
    status: "draft" | "published" | "archived" = "published",
  ) {
    const product = await createProduct({ slug, name: slug, status });
    insertedProductIds.push(product.id);
    return product;
  }

  it("excludes unpublished products", async () => {
    const draft = await makeProduct("test-listing-draft", "draft");
    const archived = await makeProduct("test-listing-archived", "archived");
    const published = await makeProduct("test-listing-published");

    const listing = await getPublishedProductListing();
    const ids = listing.map((item) => item.id);

    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(archived.id);
    expect(ids).toContain(published.id);
  });

  it("computes price-from as the lowest active variant price, ignoring deactivated variants", async () => {
    const product = await makeProduct("test-listing-price-from");
    const cheap = await createVariant({
      productId: product.id,
      sku: "TEST-LISTING-CHEAP",
      name: "Cheap",
      priceCents: 1000,
      weightGrams: 100,
    });
    await createVariant({
      productId: product.id,
      sku: "TEST-LISTING-EXPENSIVE",
      name: "Expensive",
      priceCents: 3000,
      weightGrams: 100,
    });
    const cheapest = await createVariant({
      productId: product.id,
      sku: "TEST-LISTING-CHEAPEST-INACTIVE",
      name: "Cheapest but inactive",
      priceCents: 100,
      weightGrams: 100,
    });
    await deactivateVariant(cheapest.id);
    await recordMovement({
      variantId: cheap.id,
      delta: 5,
      reason: "adjustment",
    });

    const listing = await getPublishedProductListing();
    const item = listing.find((p) => p.id === product.id);

    expect(item?.priceFromCents).toBe(1000);
  });

  it("marks a product out of stock when no active variant has positive stock", async () => {
    const product = await makeProduct("test-listing-out-of-stock");
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-LISTING-OOS",
      name: "Out of stock",
      priceCents: 1000,
      weightGrams: 100,
    });
    await recordMovement({
      variantId: variant.id,
      delta: 2,
      reason: "adjustment",
    });
    await recordMovement({
      variantId: variant.id,
      delta: -2,
      reason: "sale",
    });

    const listing = await getPublishedProductListing();
    const item = listing.find((p) => p.id === product.id);

    expect(item?.inStock).toBe(false);
  });

  it("marks a product in stock when an active variant has positive stock", async () => {
    const product = await makeProduct("test-listing-in-stock");
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-LISTING-IN-STOCK",
      name: "In stock",
      priceCents: 1000,
      weightGrams: 100,
    });
    await recordMovement({
      variantId: variant.id,
      delta: 3,
      reason: "adjustment",
    });

    const listing = await getPublishedProductListing();
    const item = listing.find((p) => p.id === product.id);

    expect(item?.inStock).toBe(true);
  });

  it("has no price and is out of stock when a product has no active variants", async () => {
    const product = await makeProduct("test-listing-no-variants");

    const listing = await getPublishedProductListing();
    const item = listing.find((p) => p.id === product.id);

    expect(item?.priceFromCents).toBeNull();
    expect(item?.inStock).toBe(false);
  });

  it("includes the lowest-position image, or null when a product has none", async () => {
    const withImage = await makeProduct("test-listing-with-image");
    const withoutImage = await makeProduct("test-listing-without-image");
    await replaceProductImages(withImage.id, [
      {
        url: "https://example.com/second.jpg",
        altText: "Second",
        position: 2,
        width: 0,
        height: 0,
      },
      {
        url: "https://example.com/first.jpg",
        altText: "First",
        position: 1,
        width: 0,
        height: 0,
      },
    ]);

    const listing = await getPublishedProductListing();
    const withImageItem = listing.find((p) => p.id === withImage.id);
    const withoutImageItem = listing.find((p) => p.id === withoutImage.id);

    expect(withImageItem?.image).toEqual({
      url: "https://example.com/first.jpg",
      altText: "First",
    });
    expect(withoutImageItem?.image).toBeNull();
  });
});
