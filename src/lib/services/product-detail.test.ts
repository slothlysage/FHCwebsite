import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  inventoryMovements,
  productAttributes,
  productImages,
  products,
  productVariants,
} from "@/lib/db/schema";
import { setProductAttribute } from "@/lib/repos/attributes";
import { replaceProductImages } from "@/lib/repos/images";
import { recordMovement } from "@/lib/repos/inventory";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { getProductDetail } from "@/lib/services/product-detail";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("getProductDetail", () => {
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
      await db
        .delete(productAttributes)
        .where(eq(productAttributes.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  it("returns null for an unknown slug", async () => {
    const detail = await getProductDetail("no-such-slug-at-all");
    expect(detail).toBeNull();
  });

  it("returns null for a draft product (not yet published)", async () => {
    const draft = await createProduct({
      slug: "test-detail-draft",
      name: "Draft Product",
      status: "draft",
    });
    insertedProductIds.push(draft.id);

    const detail = await getProductDetail("test-detail-draft");

    expect(detail).toBeNull();
  });

  it("returns null for a soft-deleted product", async () => {
    const deleted = await createProduct({
      slug: "test-detail-deleted",
      name: "Deleted Product",
      status: "published",
      deletedAt: new Date(),
    });
    insertedProductIds.push(deleted.id);

    const detail = await getProductDetail("test-detail-deleted");

    expect(detail).toBeNull();
  });

  it("assembles a full detail view for a published product", async () => {
    const product = await createProduct({
      slug: "test-detail-full",
      name: "Lavender Candle",
      description: "A calming candle.",
      ingredients: "Soy wax, lavender oil",
      safetyInfo: "Keep away from children.",
      careInfo: "Trim wick before each burn.",
      status: "published",
    });
    insertedProductIds.push(product.id);

    await replaceProductImages(product.id, [
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

    const variant = await createVariant({
      productId: product.id,
      sku: "test-detail-full-sku",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      position: 0,
    });
    await recordMovement({
      variantId: variant.id,
      delta: 5,
      reason: "import",
    });

    await setProductAttribute(product.id, "scent", "lavender");
    await setProductAttribute(product.id, "burn_time", "40 hours");

    const detail = await getProductDetail("test-detail-full");

    expect(detail).not.toBeNull();
    expect(detail?.name).toBe("Lavender Candle");
    expect(detail?.description).toBe("A calming candle.");
    expect(detail?.ingredients).toBe("Soy wax, lavender oil");
    expect(detail?.safetyInfo).toBe("Keep away from children.");
    expect(detail?.careInfo).toBe("Trim wick before each burn.");
    expect(detail?.images.map((image) => image.url)).toEqual([
      "https://example.com/first.jpg",
      "https://example.com/second.jpg",
    ]);
    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]).toMatchObject({
      sku: "test-detail-full-sku",
      name: "8oz",
      priceCents: 2400,
      weightGrams: 227,
      stock: 5,
      // Schema default — the shop produces to order, so variants are
      // backorderable unless explicitly turned off.
      allowBackorder: true,
    });
    expect(detail?.attributes).toEqual({
      scent: ["lavender"],
      burn_time: ["40 hours"],
    });
  });

  it("excludes deactivated variants and reports zero stock for a variant with no movements", async () => {
    const product = await createProduct({
      slug: "test-detail-variants",
      name: "Multi Variant Product",
      status: "published",
    });
    insertedProductIds.push(product.id);

    const active = await createVariant({
      productId: product.id,
      sku: "test-detail-variants-active",
      name: "Active",
      priceCents: 1000,
      weightGrams: 100,
      position: 0,
    });
    await createVariant({
      productId: product.id,
      sku: "test-detail-variants-inactive",
      name: "Inactive",
      priceCents: 1200,
      weightGrams: 100,
      position: 1,
      isActive: false,
    });

    const detail = await getProductDetail("test-detail-variants");

    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]?.sku).toBe(active.sku);
    expect(detail?.variants[0]?.stock).toBe(0);
  });

  it("sorts variants by position regardless of insertion order", async () => {
    const product = await createProduct({
      slug: "test-detail-variant-order",
      name: "Ordered Variants Product",
      status: "published",
    });
    insertedProductIds.push(product.id);

    await createVariant({
      productId: product.id,
      sku: "test-detail-variant-order-second",
      name: "Second",
      priceCents: 1500,
      weightGrams: 100,
      position: 1,
    });
    await createVariant({
      productId: product.id,
      sku: "test-detail-variant-order-first",
      name: "First",
      priceCents: 1000,
      weightGrams: 100,
      position: 0,
    });

    const detail = await getProductDetail("test-detail-variant-order");

    expect(detail?.variants.map((variant) => variant.sku)).toEqual([
      "test-detail-variant-order-first",
      "test-detail-variant-order-second",
    ]);
  });

  it("returns an empty attributes object for a product with none", async () => {
    const product = await createProduct({
      slug: "test-detail-no-attributes",
      name: "Plain Product",
      status: "published",
    });
    insertedProductIds.push(product.id);

    const detail = await getProductDetail("test-detail-no-attributes");

    expect(detail?.attributes).toEqual({});
  });
});
