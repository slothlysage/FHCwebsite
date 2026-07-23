import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  categories,
  inventoryMovements,
  productAttributes,
  productCategories,
  products,
  productVariants,
} from "@/lib/db/schema";
import { setProductAttribute } from "@/lib/repos/attributes";
import { createCategory, linkProductCategory } from "@/lib/repos/categories";
import { recordMovement } from "@/lib/repos/inventory";
import {
  createProduct,
  getProductById,
  getProductBySlug,
  listProducts,
  listPublishedProductsFiltered,
  softDeleteProduct,
  updateProduct,
} from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("products repo", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("creates a product with default draft status", async () => {
    const product = await createProduct({
      slug: "test-create-product",
      name: "Test Product",
    });
    insertedIds.push(product.id);

    expect(product.slug).toBe("test-create-product");
    expect(product.status).toBe("draft");
  });

  it("gets a product by id", async () => {
    const created = await createProduct({
      slug: "test-get-by-id",
      name: "Get By Id",
    });
    insertedIds.push(created.id);

    const found = await getProductById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for a nonexistent id", async () => {
    const found = await getProductById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("gets a product by slug", async () => {
    const created = await createProduct({
      slug: "test-get-by-slug",
      name: "Get By Slug",
    });
    insertedIds.push(created.id);

    const found = await getProductBySlug("test-get-by-slug");
    expect(found?.id).toBe(created.id);
  });

  it("lists only published products by default, excluding soft-deleted", async () => {
    const draft = await createProduct({
      slug: "test-list-draft",
      name: "Draft",
    });
    insertedIds.push(draft.id);
    const published = await createProduct({
      slug: "test-list-published",
      name: "Published",
      status: "published",
    });
    insertedIds.push(published.id);
    const deleted = await createProduct({
      slug: "test-list-deleted",
      name: "Deleted",
      status: "published",
    });
    insertedIds.push(deleted.id);
    await softDeleteProduct(deleted.id);

    const listed = await listProducts({ status: "published" });
    const listedIds = listed.map((p) => p.id);

    expect(listedIds).toContain(published.id);
    expect(listedIds).not.toContain(draft.id);
    expect(listedIds).not.toContain(deleted.id);
  });

  it("lists published products newest-first", async () => {
    const older = await createProduct({
      slug: "test-list-order-older",
      name: "Older",
      status: "published",
    });
    insertedIds.push(older.id);
    const newer = await createProduct({
      slug: "test-list-order-newer",
      name: "Newer",
      status: "published",
    });
    insertedIds.push(newer.id);

    const listed = await listProducts({ status: "published" });
    const olderIndex = listed.findIndex((p) => p.id === older.id);
    const newerIndex = listed.findIndex((p) => p.id === newer.id);

    expect(newerIndex).toBeLessThan(olderIndex);
  });

  it("lists across all statuses when no status filter is given", async () => {
    const draft = await createProduct({
      slug: "test-list-no-filter-draft",
      name: "Draft",
    });
    insertedIds.push(draft.id);
    const published = await createProduct({
      slug: "test-list-no-filter-published",
      name: "Published",
      status: "published",
    });
    insertedIds.push(published.id);

    const listed = await listProducts();
    const listedIds = listed.map((p) => p.id);

    expect(listedIds).toContain(draft.id);
    expect(listedIds).toContain(published.id);
  });

  it("includes soft-deleted products when includeDeleted is true", async () => {
    const deleted = await createProduct({
      slug: "test-list-include-deleted",
      name: "Deleted",
    });
    insertedIds.push(deleted.id);
    await softDeleteProduct(deleted.id);

    const listed = await listProducts({ includeDeleted: true });
    const listedIds = listed.map((p) => p.id);

    expect(listedIds).toContain(deleted.id);
  });

  it("updates a product's fields", async () => {
    const created = await createProduct({
      slug: "test-update-product",
      name: "Before",
    });
    insertedIds.push(created.id);

    const updated = await updateProduct(created.id, { name: "After" });
    expect(updated?.name).toBe("After");
  });

  it("soft-deletes a product, keeping it retrievable by id", async () => {
    const created = await createProduct({
      slug: "test-soft-delete",
      name: "Soft Delete Me",
    });
    insertedIds.push(created.id);

    const deleted = await softDeleteProduct(created.id);
    expect(deleted?.deletedAt).not.toBeNull();

    const stillFound = await getProductById(created.id);
    expect(stillFound?.id).toBe(created.id);
    expect(stillFound?.deletedAt).not.toBeNull();
  });
});

// specs/03-storefront.md's "Sort and filter" section — SQL-level filtering
// for the /products listing (2.3). Each test seeds only what it needs and
// cleans up by id, since these run against the shared dev database.
describe("listPublishedProductsFiltered", () => {
  const insertedProductIds: string[] = [];
  const insertedCategoryIds: string[] = [];

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
        .delete(productAttributes)
        .where(eq(productAttributes.productId, productId));
      await db
        .delete(productCategories)
        .where(eq(productCategories.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    for (const categoryId of insertedCategoryIds.splice(0)) {
      await db.delete(categories).where(eq(categories.id, categoryId));
    }
  });

  async function makeProduct(
    slug: string,
    overrides: Partial<typeof products.$inferInsert> = {},
  ) {
    const product = await createProduct({
      slug,
      name: slug,
      status: "published",
      ...overrides,
    });
    insertedProductIds.push(product.id);
    return product;
  }

  async function makeVariant(
    productId: string,
    sku: string,
    priceCents: number,
    options: { active?: boolean; stock?: number } = {},
  ) {
    const variant = await createVariant({
      productId,
      sku,
      name: sku,
      priceCents,
      weightGrams: 100,
      isActive: options.active ?? true,
    });
    if (options.stock !== undefined) {
      await recordMovement({
        variantId: variant.id,
        delta: options.stock,
        reason: "adjustment",
      });
    }
    return variant;
  }

  it("excludes draft and archived products", async () => {
    const draft = await makeProduct("test-filter-draft", { status: "draft" });
    const archived = await makeProduct("test-filter-archived", {
      status: "archived",
    });
    const published = await makeProduct("test-filter-published");

    const result = await listPublishedProductsFiltered();
    const ids = result.map((p) => p.id);

    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(archived.id);
    expect(ids).toContain(published.id);
  });

  it("filters by a single category", async () => {
    const category = await createCategory({
      slug: "test-filter-category-candles",
      name: "Candles",
    });
    insertedCategoryIds.push(category.id);
    const inCategory = await makeProduct("test-filter-cat-in");
    const outOfCategory = await makeProduct("test-filter-cat-out");
    await linkProductCategory(inCategory.id, category.id);

    const result = await listPublishedProductsFiltered({
      categorySlugs: [category.slug],
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(inCategory.id);
    expect(ids).not.toContain(outOfCategory.id);
  });

  it("ORs multiple values within the same facet (category)", async () => {
    const candles = await createCategory({
      slug: "test-filter-or-candles",
      name: "Candles",
    });
    insertedCategoryIds.push(candles.id);
    const soap = await createCategory({
      slug: "test-filter-or-soap",
      name: "Soap",
    });
    insertedCategoryIds.push(soap.id);
    const candleProduct = await makeProduct("test-filter-or-candle-product");
    const soapProduct = await makeProduct("test-filter-or-soap-product");
    const neitherProduct = await makeProduct("test-filter-or-neither");
    await linkProductCategory(candleProduct.id, candles.id);
    await linkProductCategory(soapProduct.id, soap.id);

    const result = await listPublishedProductsFiltered({
      categorySlugs: [candles.slug, soap.slug],
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(candleProduct.id);
    expect(ids).toContain(soapProduct.id);
    expect(ids).not.toContain(neitherProduct.id);
  });

  it("filters by scent attribute", async () => {
    const lavender = await makeProduct("test-filter-scent-lavender");
    const vanilla = await makeProduct("test-filter-scent-vanilla");
    await setProductAttribute(lavender.id, "scent", "lavender");
    await setProductAttribute(vanilla.id, "scent", "vanilla");

    const result = await listPublishedProductsFiltered({
      scents: ["lavender"],
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(lavender.id);
    expect(ids).not.toContain(vanilla.id);
  });

  it("filters by size attribute", async () => {
    const small = await makeProduct("test-filter-size-small");
    const large = await makeProduct("test-filter-size-large");
    await setProductAttribute(small.id, "size", "4oz");
    await setProductAttribute(large.id, "size", "8oz");

    const result = await listPublishedProductsFiltered({ sizes: ["8oz"] });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(large.id);
    expect(ids).not.toContain(small.id);
  });

  it("matches a price range if any variant (not just the cheapest) falls inside it", async () => {
    const product = await makeProduct("test-filter-price-any-variant");
    await makeVariant(product.id, "TEST-FILTER-PRICE-CHEAP", 500);
    await makeVariant(product.id, "TEST-FILTER-PRICE-MID", 2000);
    const outOfRangeOnly = await makeProduct("test-filter-price-out-of-range");
    await makeVariant(outOfRangeOnly.id, "TEST-FILTER-PRICE-HIGH", 9000);

    const result = await listPublishedProductsFiltered({
      minPriceCents: 1000,
      maxPriceCents: 3000,
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(product.id);
    expect(ids).not.toContain(outOfRangeOnly.id);
  });

  it("filters by minPrice alone (no upper bound)", async () => {
    const cheap = await makeProduct("test-filter-min-price-only-cheap");
    await makeVariant(cheap.id, "TEST-FILTER-MIN-ONLY-CHEAP", 500);
    const expensive = await makeProduct("test-filter-min-price-only-expensive");
    await makeVariant(expensive.id, "TEST-FILTER-MIN-ONLY-EXP", 5000);

    const result = await listPublishedProductsFiltered({
      minPriceCents: 1000,
    });
    const ids = result.map((p) => p.id);

    expect(ids).not.toContain(cheap.id);
    expect(ids).toContain(expensive.id);
  });

  it("filters by maxPrice alone (no lower bound)", async () => {
    const cheap = await makeProduct("test-filter-max-price-only-cheap");
    await makeVariant(cheap.id, "TEST-FILTER-MAX-ONLY-CHEAP", 500);
    const expensive = await makeProduct("test-filter-max-price-only-expensive");
    await makeVariant(expensive.id, "TEST-FILTER-MAX-ONLY-EXP", 5000);

    const result = await listPublishedProductsFiltered({
      maxPriceCents: 1000,
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(cheap.id);
    expect(ids).not.toContain(expensive.id);
  });

  it("returns an empty result, not an error, when minPrice exceeds maxPrice", async () => {
    const product = await makeProduct("test-filter-price-inverted");
    await makeVariant(product.id, "TEST-FILTER-PRICE-INVERTED", 1500);

    const result = await listPublishedProductsFiltered({
      minPriceCents: 3000,
      maxPriceCents: 1000,
    });

    expect(result.map((p) => p.id)).not.toContain(product.id);
  });

  it("filters to in-stock-only products", async () => {
    const inStock = await makeProduct("test-filter-in-stock");
    await makeVariant(inStock.id, "TEST-FILTER-IN-STOCK", 1000, { stock: 3 });
    const outOfStock = await makeProduct("test-filter-out-of-stock");
    await makeVariant(outOfStock.id, "TEST-FILTER-OUT-OF-STOCK", 1000, {
      stock: 0,
    });

    const result = await listPublishedProductsFiltered({ inStockOnly: true });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(inStock.id);
    expect(ids).not.toContain(outOfStock.id);
  });

  it("ANDs different facets together (category AND inStockOnly)", async () => {
    const category = await createCategory({
      slug: "test-filter-and-category",
      name: "And Category",
    });
    insertedCategoryIds.push(category.id);

    const matches = await makeProduct("test-filter-and-matches");
    await linkProductCategory(matches.id, category.id);
    await makeVariant(matches.id, "TEST-FILTER-AND-MATCHES", 1000, {
      stock: 2,
    });

    const wrongCategory = await makeProduct("test-filter-and-wrong-category");
    await makeVariant(wrongCategory.id, "TEST-FILTER-AND-WRONG-CAT", 1000, {
      stock: 2,
    });

    const outOfStockInCategory = await makeProduct(
      "test-filter-and-out-of-stock",
    );
    await linkProductCategory(outOfStockInCategory.id, category.id);
    await makeVariant(outOfStockInCategory.id, "TEST-FILTER-AND-OOS", 1000, {
      stock: 0,
    });

    const result = await listPublishedProductsFiltered({
      categorySlugs: [category.slug],
      inStockOnly: true,
    });
    const ids = result.map((p) => p.id);

    expect(ids).toContain(matches.id);
    expect(ids).not.toContain(wrongCategory.id);
    expect(ids).not.toContain(outOfStockInCategory.id);
  });

  it("sorts by price ascending using each product's minimum active variant price, tie-broken by id", async () => {
    const cheap = await makeProduct("test-filter-sort-cheap");
    await makeVariant(cheap.id, "TEST-FILTER-SORT-CHEAP", 500);
    const mid = await makeProduct("test-filter-sort-mid");
    await makeVariant(mid.id, "TEST-FILTER-SORT-MID", 1500);
    const expensive = await makeProduct("test-filter-sort-expensive");
    await makeVariant(expensive.id, "TEST-FILTER-SORT-EXPENSIVE", 3000);

    const result = await listPublishedProductsFiltered({ sort: "price_asc" });
    const ids = result
      .map((p) => p.id)
      .filter((id) => [cheap.id, mid.id, expensive.id].includes(id));

    expect(ids).toEqual([cheap.id, mid.id, expensive.id]);
  });

  it("sorts by price descending", async () => {
    const cheap = await makeProduct("test-filter-sort-desc-cheap");
    await makeVariant(cheap.id, "TEST-FILTER-SORT-DESC-CHEAP", 500);
    const expensive = await makeProduct("test-filter-sort-desc-expensive");
    await makeVariant(expensive.id, "TEST-FILTER-SORT-DESC-EXPENSIVE", 3000);

    const result = await listPublishedProductsFiltered({
      sort: "price_desc",
    });
    const ids = result
      .map((p) => p.id)
      .filter((id) => [cheap.id, expensive.id].includes(id));

    expect(ids).toEqual([expensive.id, cheap.id]);
  });

  it("sorts by name ascending", async () => {
    const zebra = await makeProduct("test-filter-sort-name-zebra", {
      name: "Zebra Candle",
    });
    const apple = await makeProduct("test-filter-sort-name-apple", {
      name: "Apple Candle",
    });

    const result = await listPublishedProductsFiltered({ sort: "name_asc" });
    const ids = result
      .map((p) => p.id)
      .filter((id) => [zebra.id, apple.id].includes(id));

    expect(ids).toEqual([apple.id, zebra.id]);
  });

  it("defaults to newest-first when no sort is given", async () => {
    const older = await makeProduct("test-filter-sort-newest-older");
    const newer = await makeProduct("test-filter-sort-newest-newer");

    const result = await listPublishedProductsFiltered();
    const ids = result
      .map((p) => p.id)
      .filter((id) => [older.id, newer.id].includes(id));

    expect(ids).toEqual([newer.id, older.id]);
  });

  it("returns an empty array when no product matches", async () => {
    const result = await listPublishedProductsFiltered({
      categorySlugs: ["no-such-category-slug-at-all"],
    });
    expect(result).toEqual([]);
  });

  it("includes priceFromCents and inStock on each result", async () => {
    const product = await makeProduct("test-filter-shape");
    await makeVariant(product.id, "TEST-FILTER-SHAPE", 1234, { stock: 5 });

    const result = await listPublishedProductsFiltered();
    const item = result.find((p) => p.id === product.id);

    expect(item?.priceFromCents).toBe(1234);
    expect(item?.inStock).toBe(true);
  });
});
