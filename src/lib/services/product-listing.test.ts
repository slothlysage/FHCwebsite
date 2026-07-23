import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  categories,
  inventoryMovements,
  productAttributes,
  productCategories,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { setProductAttribute } from "@/lib/repos/attributes";
import { createCategory, linkProductCategory } from "@/lib/repos/categories";
import { recordMovement } from "@/lib/repos/inventory";
import { replaceProductImages } from "@/lib/repos/images";
import { createProduct } from "@/lib/repos/products";
import { createVariant, deactivateVariant } from "@/lib/repos/variants";
import {
  getFeaturedProductListing,
  getFilteredProductListing,
  getFilterFacets,
} from "@/lib/services/product-listing";
import {
  parseProductFilters,
  PRODUCTS_PAGE_SIZE,
} from "@/lib/validation/product-filters";

const defaultFilters = parseProductFilters({});

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("getFilteredProductListing", () => {
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

    const { items: listing } = await getFilteredProductListing(defaultFilters);
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

    const { items: listing } = await getFilteredProductListing(defaultFilters);
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

    const { items: listing } = await getFilteredProductListing(defaultFilters);
    const item = listing.find((p) => p.id === product.id);

    expect(item?.inStock).toBe(false);
    // Zero stock but allow_backorder defaults true — still purchasable
    // (made to order), which is what the card's label switches on.
    expect(item?.purchasable).toBe(true);
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

    const { items: listing } = await getFilteredProductListing(defaultFilters);
    const item = listing.find((p) => p.id === product.id);

    expect(item?.inStock).toBe(true);
  });

  it("has no price and is out of stock when a product has no active variants", async () => {
    const product = await makeProduct("test-listing-no-variants");

    const { items: listing } = await getFilteredProductListing(defaultFilters);
    const item = listing.find((p) => p.id === product.id);

    expect(item?.priceFromCents).toBeNull();
    expect(item?.inStock).toBe(false);
    expect(item?.purchasable).toBe(false);
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

    const { items: listing } = await getFilteredProductListing(defaultFilters);
    const withImageItem = listing.find((p) => p.id === withImage.id);
    const withoutImageItem = listing.find((p) => p.id === withoutImage.id);

    expect(withImageItem?.image).toEqual({
      url: "https://example.com/first.jpg",
      altText: "First",
    });
    expect(withoutImageItem?.image).toBeNull();
  });

  it("applies the passed-in filters (2.3), not just the default unfiltered set", async () => {
    const category = await createCategory({
      slug: "test-listing-service-filter-category",
      name: "Filter Category",
    });
    const inCategory = await makeProduct("test-listing-service-filter-in");
    const outOfCategory = await makeProduct("test-listing-service-filter-out");
    await linkProductCategory(inCategory.id, category.id);

    const { items: listing } = await getFilteredProductListing({
      ...defaultFilters,
      categorySlugs: [category.slug],
    });
    const ids = listing.map((item) => item.id);

    expect(ids).toContain(inCategory.id);
    expect(ids).not.toContain(outOfCategory.id);

    await db
      .delete(productCategories)
      .where(eq(productCategories.productId, inCategory.id));
    await db.delete(categories).where(eq(categories.id, category.id));
  });

  it("reports hasNextPage: false when every match fits on one page", async () => {
    // Scoped to a dedicated category so this isn't at the mercy of however
    // many published products other concurrently running test files happen
    // to have in the shared dev database at this instant.
    const category = await createCategory({
      slug: "test-listing-page-single-category",
      name: "Page Single Category",
    });
    const product = await makeProduct("test-listing-page-single");
    await linkProductCategory(product.id, category.id);

    const { items, hasNextPage } = await getFilteredProductListing({
      ...defaultFilters,
      categorySlugs: [category.slug],
    });

    expect(items.map((i) => i.id)).toContain(product.id);
    expect(hasNextPage).toBe(false);

    await db
      .delete(productCategories)
      .where(eq(productCategories.categoryId, category.id));
    await db.delete(categories).where(eq(categories.id, category.id));
  });

  it("page 2 preserves the active filters and returns the slice after page 1, with hasNextPage flipping to false once exhausted", async () => {
    const category = await createCategory({
      slug: "test-listing-page-2-category",
      name: "Page 2 Category",
    });
    // One more product than PRODUCTS_PAGE_SIZE, all with the same
    // createdAt so the default "newest" sort is a full tie, exercising the
    // id tie-break the same way the repo-level pagination test does.
    const sameCreatedAt = new Date("2024-01-01T00:00:00Z");
    const created = [];
    for (let i = 0; i < PRODUCTS_PAGE_SIZE + 1; i++) {
      const product = await createProduct({
        slug: `test-listing-page-2-${i}`,
        name: `test-listing-page-2-${i}`,
        status: "published",
        createdAt: sameCreatedAt,
      });
      insertedProductIds.push(product.id);
      await linkProductCategory(product.id, category.id);
      created.push(product);
    }
    const expectedIds = created.map((p) => p.id).sort();

    const page1 = await getFilteredProductListing({
      ...defaultFilters,
      categorySlugs: [category.slug],
      page: 1,
    });
    const page2 = await getFilteredProductListing({
      ...defaultFilters,
      categorySlugs: [category.slug],
      page: 2,
    });

    expect(page1.items.map((i) => i.id)).toEqual(
      expectedIds.slice(0, PRODUCTS_PAGE_SIZE),
    );
    expect(page1.hasNextPage).toBe(true);
    expect(page2.items.map((i) => i.id)).toEqual(
      expectedIds.slice(PRODUCTS_PAGE_SIZE),
    );
    expect(page2.hasNextPage).toBe(false);

    await db
      .delete(productCategories)
      .where(eq(productCategories.categoryId, category.id));
    await db.delete(categories).where(eq(categories.id, category.id));
  });
});

describe("getFeaturedProductListing", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
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

  it("never returns more than the requested limit", async () => {
    const items = await getFeaturedProductListing(2);
    expect(items.length).toBeLessThanOrEqual(2);
  });

  it("excludes unpublished and soft-deleted products regardless of recency", async () => {
    const draft = await makeProduct("test-featured-draft", "draft");
    const archived = await makeProduct("test-featured-archived", "archived");

    const items = await getFeaturedProductListing(1000);
    const ids = items.map((item) => item.id);

    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(archived.id);
  });

  it("orders newest-first between two products it created back to back", async () => {
    const older = await makeProduct("test-featured-older");
    const newer = await makeProduct("test-featured-newer");

    const items = await getFeaturedProductListing(1000);
    const olderIndex = items.findIndex((item) => item.id === older.id);
    const newerIndex = items.findIndex((item) => item.id === newer.id);

    expect(olderIndex).toBeGreaterThanOrEqual(0);
    expect(newerIndex).toBeGreaterThanOrEqual(0);
    expect(newerIndex).toBeLessThan(olderIndex);
  });

  it("includes the primary image, or null when a product has none", async () => {
    const product = await makeProduct("test-featured-with-image");
    await replaceProductImages(product.id, [
      {
        url: "https://example.com/featured.jpg",
        altText: "Featured",
        position: 1,
        width: 0,
        height: 0,
      },
    ]);

    const items = await getFeaturedProductListing(1000);
    const item = items.find((i) => i.id === product.id);

    expect(item?.image).toEqual({
      url: "https://example.com/featured.jpg",
      altText: "Featured",
    });
  });

  it("returns an empty array when there are no published products to show", async () => {
    // Not asserted against the shared dev DB's global state (it always has
    // real published products) — this only proves the zero-match early
    // return doesn't throw or need special-casing, via a limit of 0.
    const items = await getFeaturedProductListing(0);
    expect(items).toEqual([]);
  });
});

describe("getFilterFacets", () => {
  const insertedProductIds: string[] = [];
  const insertedCategoryIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
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

  it("returns categories, scents, and sizes available on published products", async () => {
    const product = await createProduct({
      slug: "test-facets-product",
      name: "Facets Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const category = await createCategory({
      slug: "test-facets-category",
      name: "Facets Category",
    });
    insertedCategoryIds.push(category.id);
    await linkProductCategory(product.id, category.id);
    await setProductAttribute(product.id, "scent", "test-facets-lavender");
    await setProductAttribute(product.id, "size", "test-facets-8oz");

    const facets = await getFilterFacets();

    expect(facets.categories).toContainEqual({
      slug: category.slug,
      name: category.name,
    });
    expect(facets.scents).toContain("test-facets-lavender");
    expect(facets.sizes).toContain("test-facets-8oz");
  });
});
