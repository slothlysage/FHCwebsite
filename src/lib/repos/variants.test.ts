import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import {
  createVariant,
  deactivateVariant,
  getVariantById,
  listActiveVariantsByProductId,
  listVariantsByProductId,
  updateVariant,
} from "@/lib/repos/variants";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("variants repo", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeProduct(slug: string) {
    const product = await createProduct({ slug, name: slug });
    insertedProductIds.push(product.id);
    return product;
  }

  it("creates a variant", async () => {
    const product = await makeProduct("test-variant-create");

    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-CREATE-SKU",
      name: "8oz — Lavender",
      priceCents: 1999,
      weightGrams: 227,
    });

    expect(variant.productId).toBe(product.id);
    expect(variant.sku).toBe("TEST-CREATE-SKU");
    expect(variant.isActive).toBe(true);
  });

  it("gets a variant by id", async () => {
    const product = await makeProduct("test-variant-get-by-id");
    const created = await createVariant({
      productId: product.id,
      sku: "TEST-GET-BY-ID-SKU",
      name: "Get By Id",
      priceCents: 1000,
      weightGrams: 100,
    });

    const found = await getVariantById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for a nonexistent id", async () => {
    const found = await getVariantById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("lists all variants for a product", async () => {
    const product = await makeProduct("test-variant-list");
    const a = await createVariant({
      productId: product.id,
      sku: "TEST-LIST-A",
      name: "A",
      priceCents: 1000,
      weightGrams: 100,
    });
    const b = await createVariant({
      productId: product.id,
      sku: "TEST-LIST-B",
      name: "B",
      priceCents: 1500,
      weightGrams: 150,
    });

    const listed = await listVariantsByProductId(product.id);
    const listedIds = listed.map((v) => v.id);

    expect(listedIds).toContain(a.id);
    expect(listedIds).toContain(b.id);
  });

  it("excludes deactivated variants from the active-variants query", async () => {
    const product = await makeProduct("test-variant-active-only");
    const active = await createVariant({
      productId: product.id,
      sku: "TEST-ACTIVE-ONLY-ACTIVE",
      name: "Active",
      priceCents: 1000,
      weightGrams: 100,
    });
    const inactive = await createVariant({
      productId: product.id,
      sku: "TEST-ACTIVE-ONLY-INACTIVE",
      name: "Inactive",
      priceCents: 1000,
      weightGrams: 100,
    });
    await deactivateVariant(inactive.id);

    const listed = await listActiveVariantsByProductId(product.id);
    const listedIds = listed.map((v) => v.id);

    expect(listedIds).toContain(active.id);
    expect(listedIds).not.toContain(inactive.id);
  });

  it("updates a variant's fields", async () => {
    const product = await makeProduct("test-variant-update");
    const created = await createVariant({
      productId: product.id,
      sku: "TEST-UPDATE-SKU",
      name: "Before",
      priceCents: 1000,
      weightGrams: 100,
    });

    const updated = await updateVariant(created.id, {
      name: "After",
      priceCents: 1200,
    });

    expect(updated?.name).toBe("After");
    expect(updated?.priceCents).toBe(1200);
  });

  it("deactivates a variant without deleting it", async () => {
    const product = await makeProduct("test-variant-deactivate");
    const created = await createVariant({
      productId: product.id,
      sku: "TEST-DEACTIVATE-SKU",
      name: "Deactivate Me",
      priceCents: 1000,
      weightGrams: 100,
    });

    const deactivated = await deactivateVariant(created.id);
    expect(deactivated?.isActive).toBe(false);

    const stillFound = await getVariantById(created.id);
    expect(stillFound?.id).toBe(created.id);
    expect(stillFound?.isActive).toBe(false);
  });
});
