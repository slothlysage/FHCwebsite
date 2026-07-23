import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  inventoryMovements,
  productCategories,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { getCategoryBySlug } from "@/lib/repos/categories";
import { getProductBySlug } from "@/lib/repos/products";
import { getVariantBySku } from "@/lib/repos/variants";
import type { ParsedProduct } from "@/lib/services/catalog-importer";
import { runCatalogImport } from "@/lib/services/catalog-import";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("runCatalogImport", () => {
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
        .delete(productCategories)
        .where(eq(productCategories.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  function parsedProduct(
    overrides: Partial<ParsedProduct> = {},
  ): ParsedProduct {
    return {
      handle: "test-import-candle",
      slug: "test-import-candle",
      name: "Test Import Candle",
      description: "A candle for testing the importer",
      status: "draft",
      categories: ["candles", "seasonal"],
      variants: [
        {
          sku: "TEST-IMPORT-8OZ",
          name: "8oz",
          priceCents: 2400,
          compareAtPriceCents: null,
          weightGrams: 227,
          position: 0,
          stockQuantity: 10,
        },
      ],
      images: [
        {
          url: "https://example.com/candle.jpg",
          altText: "Candle",
          position: 1,
        },
      ],
      ...overrides,
    };
  }

  it("dry-run reports a new product/variant as 'create' and writes nothing", async () => {
    const result = await runCatalogImport([parsedProduct()], { apply: false });

    expect(result.products).toEqual([
      {
        slug: "test-import-candle",
        action: "create",
        variants: [{ sku: "TEST-IMPORT-8OZ", action: "create" }],
      },
    ]);

    const found = await getProductBySlug("test-import-candle");
    expect(found).toBeUndefined();
  });

  it("apply creates the product, variant, category links, images, and an import movement", async () => {
    const result = await runCatalogImport([parsedProduct()], { apply: true });
    expect(result.products[0]?.action).toBe("create");
    expect(result.products[0]?.variants[0]?.action).toBe("create");

    const product = await getProductBySlug("test-import-candle");
    expect(product).toBeDefined();
    insertedProductIds.push(product!.id);

    const variant = await getVariantBySku("TEST-IMPORT-8OZ");
    expect(variant?.productId).toBe(product!.id);
    expect(variant?.priceCents).toBe(2400);

    const category = await getCategoryBySlug("candles");
    expect(category).toBeDefined();
    const links = await db
      .select()
      .from(productCategories)
      .where(eq(productCategories.productId, product!.id));
    expect(links).toHaveLength(2);

    const images = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product!.id));
    expect(images).toHaveLength(1);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant!.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]?.delta).toBe(10);
    expect(movements[0]?.reason).toBe("import");
  });

  it("re-applying the same file reports 'unchanged' and does not duplicate rows", async () => {
    await runCatalogImport([parsedProduct()], { apply: true });
    const product = await getProductBySlug("test-import-candle");
    insertedProductIds.push(product!.id);

    const second = await runCatalogImport([parsedProduct()], { apply: true });

    expect(second.products).toEqual([
      {
        slug: "test-import-candle",
        action: "unchanged",
        variants: [{ sku: "TEST-IMPORT-8OZ", action: "unchanged" }],
      },
    ]);

    const variant = await getVariantBySku("TEST-IMPORT-8OZ");
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant!.id));
    expect(movements).toHaveLength(1);

    const images = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product!.id));
    expect(images).toHaveLength(1);

    const links = await db
      .select()
      .from(productCategories)
      .where(eq(productCategories.productId, product!.id));
    expect(links).toHaveLength(2);
  });

  it("reports and applies an 'update' when a product/variant field changed", async () => {
    await runCatalogImport([parsedProduct()], { apply: true });
    const product = await getProductBySlug("test-import-candle");
    insertedProductIds.push(product!.id);

    const changed = parsedProduct({
      name: "Test Import Candle (Renamed)",
    });
    changed.variants[0]!.priceCents = 2600;

    const result = await runCatalogImport([changed], { apply: true });

    expect(result.products[0]?.action).toBe("update");
    expect(result.products[0]?.variants[0]?.action).toBe("update");

    const updatedProduct = await getProductBySlug("test-import-candle");
    expect(updatedProduct?.name).toBe("Test Import Candle (Renamed)");
    const updatedVariant = await getVariantBySku("TEST-IMPORT-8OZ");
    expect(updatedVariant?.priceCents).toBe(2600);

    // Updating an existing variant must not write another import movement.
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, updatedVariant!.id));
    expect(movements).toHaveLength(1);
  });

  it("adds a new variant to an existing product without disturbing the existing one", async () => {
    await runCatalogImport([parsedProduct()], { apply: true });
    const product = await getProductBySlug("test-import-candle");
    insertedProductIds.push(product!.id);

    const withNewVariant = parsedProduct();
    withNewVariant.variants.push({
      sku: "TEST-IMPORT-16OZ",
      name: "16oz",
      priceCents: 4200,
      compareAtPriceCents: null,
      weightGrams: 454,
      position: 1,
      stockQuantity: 5,
    });

    const result = await runCatalogImport([withNewVariant], { apply: true });

    expect(result.products[0]?.action).toBe("unchanged");
    expect(result.products[0]?.variants).toEqual([
      { sku: "TEST-IMPORT-8OZ", action: "unchanged" },
      { sku: "TEST-IMPORT-16OZ", action: "create" },
    ]);

    const newVariant = await getVariantBySku("TEST-IMPORT-16OZ");
    expect(newVariant?.productId).toBe(product!.id);
  });

  it("apply writes the parsed status on create", async () => {
    await runCatalogImport([parsedProduct({ status: "published" })], {
      apply: true,
    });

    const product = await getProductBySlug("test-import-candle");
    insertedProductIds.push(product!.id);
    expect(product?.status).toBe("published");
  });

  it("reports and applies a status-only change as an 'update'", async () => {
    await runCatalogImport([parsedProduct({ status: "draft" })], {
      apply: true,
    });
    const product = await getProductBySlug("test-import-candle");
    insertedProductIds.push(product!.id);
    expect(product?.status).toBe("draft");

    const result = await runCatalogImport(
      [parsedProduct({ status: "published" })],
      { apply: true },
    );

    expect(result.products[0]?.action).toBe("update");
    const updated = await getProductBySlug("test-import-candle");
    expect(updated?.status).toBe("published");
  });
});
