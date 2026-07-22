import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { categories, productCategories, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import {
  createCategory,
  getCategoryBySlug,
  linkProductCategory,
} from "@/lib/repos/categories";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("categories repo", () => {
  const insertedCategoryIds: string[] = [];
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productCategories)
        .where(eq(productCategories.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    for (const categoryId of insertedCategoryIds.splice(0)) {
      await db.delete(categories).where(eq(categories.id, categoryId));
    }
  });

  it("creates a category", async () => {
    const category = await createCategory({
      slug: "test-create-category",
      name: "Test Create Category",
    });
    insertedCategoryIds.push(category.id);

    expect(category.slug).toBe("test-create-category");
  });

  it("gets a category by slug", async () => {
    const created = await createCategory({
      slug: "test-get-category",
      name: "Test Get Category",
    });
    insertedCategoryIds.push(created.id);

    const found = await getCategoryBySlug("test-get-category");
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for a nonexistent slug", async () => {
    const found = await getCategoryBySlug("no-such-category");
    expect(found).toBeUndefined();
  });

  it("links a product to a category", async () => {
    const product = await createProduct({
      slug: "test-link-category-product",
      name: "Linked Product",
    });
    insertedProductIds.push(product.id);
    const category = await createCategory({
      slug: "test-link-category",
      name: "Test Link Category",
    });
    insertedCategoryIds.push(category.id);

    await linkProductCategory(product.id, category.id);

    const links = await db
      .select()
      .from(productCategories)
      .where(eq(productCategories.productId, product.id));
    expect(links).toHaveLength(1);
    expect(links[0]?.categoryId).toBe(category.id);
  });

  it("does not duplicate a link when called twice for the same pair", async () => {
    const product = await createProduct({
      slug: "test-link-category-idempotent",
      name: "Idempotent Product",
    });
    insertedProductIds.push(product.id);
    const category = await createCategory({
      slug: "test-link-category-idempotent",
      name: "Idempotent Category",
    });
    insertedCategoryIds.push(category.id);

    await linkProductCategory(product.id, category.id);
    await linkProductCategory(product.id, category.id);

    const links = await db
      .select()
      .from(productCategories)
      .where(eq(productCategories.productId, product.id));
    expect(links).toHaveLength(1);
  });
});
