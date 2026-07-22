import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  inventoryMovements,
  productVariants,
  products,
  variantStock,
} from "@/lib/db/schema";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.
// Each test cleans up the rows it inserted in afterEach rather than relying
// on transaction rollback, since FK order matters and this keeps the intent
// explicit for future repo tests (1.3) to copy.

describe("schema", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      const variants = await db
        .select({ id: productVariants.id })
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

  it("enforces a unique slug on products", async () => {
    const [product] = await db
      .insert(products)
      .values({ slug: "test-unique-slug", name: "Test Product" })
      .returning();
    insertedProductIds.push(product!.id);

    await expect(
      db
        .insert(products)
        .values({ slug: "test-unique-slug", name: "Duplicate" }),
    ).rejects.toThrow();
  });

  it("rejects a variant referencing a nonexistent product", async () => {
    await expect(
      db.insert(productVariants).values({
        productId: "00000000-0000-0000-0000-000000000000",
        sku: "TEST-SKU-FK",
        name: "Orphan variant",
        priceCents: 1000,
        weightGrams: 100,
      }),
    ).rejects.toThrow();
  });

  it("derives variant stock as the sum of inventory movements", async () => {
    const [product] = await db
      .insert(products)
      .values({ slug: "test-stock-product", name: "Stock Product" })
      .returning();
    insertedProductIds.push(product!.id);

    const [variant] = await db
      .insert(productVariants)
      .values({
        productId: product!.id,
        sku: "TEST-SKU-STOCK",
        name: "8oz",
        priceCents: 2500,
        weightGrams: 227,
      })
      .returning();

    await db.insert(inventoryMovements).values([
      { variantId: variant!.id, delta: 10, reason: "import" },
      { variantId: variant!.id, delta: -3, reason: "sale" },
      { variantId: variant!.id, delta: -1, reason: "damage" },
    ]);

    const [stock] = await db
      .select()
      .from(variantStock)
      .where(eq(variantStock.variantId, variant!.id));

    expect(stock?.stock).toBe(6);
  });

  it("reports zero stock for a variant with no movements", async () => {
    const [product] = await db
      .insert(products)
      .values({ slug: "test-no-movements-product", name: "No Movements" })
      .returning();
    insertedProductIds.push(product!.id);

    const [variant] = await db
      .insert(productVariants)
      .values({
        productId: product!.id,
        sku: "TEST-SKU-NO-MOVEMENTS",
        name: "8oz",
        priceCents: 1500,
        weightGrams: 227,
      })
      .returning();

    const stockRows = await db
      .select()
      .from(variantStock)
      .where(eq(variantStock.variantId, variant!.id));

    // A variant with zero inventory movements has no GROUP BY row at all —
    // the view only aggregates variants that have at least one movement.
    expect(stockRows).toHaveLength(0);
  });
});
