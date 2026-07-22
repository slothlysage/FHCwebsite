import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { inventoryMovements, productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import {
  getStockForVariant,
  getStockForVariants,
  recordMovement,
} from "@/lib/repos/inventory";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("inventory repo", () => {
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
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeVariant(slug: string) {
    const product = await createProduct({ slug, name: slug });
    insertedProductIds.push(product.id);
    return createVariant({
      productId: product.id,
      sku: `${slug}-SKU`.toUpperCase(),
      name: slug,
      priceCents: 1000,
      weightGrams: 100,
    });
  }

  it("records a movement", async () => {
    const variant = await makeVariant("test-inventory-record");

    const movement = await recordMovement({
      variantId: variant.id,
      delta: 10,
      reason: "import",
    });

    expect(movement.variantId).toBe(variant.id);
    expect(movement.delta).toBe(10);
    expect(movement.reason).toBe("import");
  });

  it("sums movements into stock for a variant", async () => {
    const variant = await makeVariant("test-inventory-sum");

    await recordMovement({
      variantId: variant.id,
      delta: 10,
      reason: "import",
    });
    await recordMovement({ variantId: variant.id, delta: -3, reason: "sale" });

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(7);
  });

  it("returns 0 stock for a variant with no movements", async () => {
    const variant = await makeVariant("test-inventory-zero");

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(0);
  });

  it("batches stock lookups for multiple variants", async () => {
    const a = await makeVariant("test-inventory-batch-a");
    const b = await makeVariant("test-inventory-batch-b");
    const c = await makeVariant("test-inventory-batch-c");

    await recordMovement({ variantId: a.id, delta: 5, reason: "import" });
    await recordMovement({ variantId: b.id, delta: 2, reason: "import" });
    await recordMovement({ variantId: b.id, delta: -1, reason: "sale" });
    // c has no movements at all — must still come back as 0.

    const stock = await getStockForVariants([a.id, b.id, c.id]);

    expect(stock.get(a.id)).toBe(5);
    expect(stock.get(b.id)).toBe(1);
    expect(stock.get(c.id)).toBe(0);
  });

  it("returns an empty map for an empty batch", async () => {
    const stock = await getStockForVariants([]);
    expect(stock.size).toBe(0);
  });
});
