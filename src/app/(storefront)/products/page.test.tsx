import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import { categories, productCategories, products } from "@/lib/db/schema";
import { createCategory, linkProductCategory } from "@/lib/repos/categories";
import { createProduct } from "@/lib/repos/products";
import type { RawSearchParams } from "@/lib/validation/product-filters";
import ProductsPage from "./page";

// Integration test against a real Postgres (specs/06-testing.md) — the page
// is an async Server Component, so it's invoked directly and awaited rather
// than passed to render() as a JSX element.

function withSearchParams(searchParams: RawSearchParams = {}) {
  return ProductsPage({ searchParams: Promise.resolve(searchParams) });
}

describe("ProductsPage", () => {
  const insertedIds: string[] = [];
  const insertedCategoryIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db
        .delete(productCategories)
        .where(eq(productCategories.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
    for (const id of insertedCategoryIds.splice(0)) {
      await db.delete(categories).where(eq(categories.id, id));
    }
  });

  it("renders published products and excludes drafts", async () => {
    const published = await createProduct({
      slug: "test-products-page-published",
      name: "Published Product",
      status: "published",
    });
    insertedIds.push(published.id);
    const draft = await createProduct({
      slug: "test-products-page-draft",
      name: "Draft Product",
      status: "draft",
    });
    insertedIds.push(draft.id);

    render(await withSearchParams());

    expect(
      screen.getByRole("link", { name: /published product/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /draft product/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a page heading", async () => {
    render(await withSearchParams());
    expect(screen.getByRole("heading", { name: /shop/i })).toBeInTheDocument();
  });

  it("applies a category filter from the URL query string", async () => {
    const category = await createCategory({
      slug: "test-products-page-category",
      name: "Test Page Category",
    });
    insertedCategoryIds.push(category.id);
    const inCategory = await createProduct({
      slug: "test-products-page-in-category",
      name: "In Category Product",
      status: "published",
    });
    insertedIds.push(inCategory.id);
    const outOfCategory = await createProduct({
      slug: "test-products-page-out-of-category",
      name: "Out Of Category Product",
      status: "published",
    });
    insertedIds.push(outOfCategory.id);
    await linkProductCategory(inCategory.id, category.id);

    render(await withSearchParams({ category: category.slug }));

    expect(
      screen.getByRole("link", { name: /in category product/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /out of category product/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a filtered empty state with a working clear-filters link when nothing matches", async () => {
    render(
      await withSearchParams({ category: "no-such-category-slug-anywhere" }),
    );

    expect(
      screen.getByText(/no products match your filters/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/products");
  });

  it("ignores unknown query parameters instead of erroring", async () => {
    const published = await createProduct({
      slug: "test-products-page-unknown-param",
      name: "Unknown Param Product",
      status: "published",
    });
    insertedIds.push(published.id);

    render(await withSearchParams({ utm_source: "newsletter" }));

    expect(
      screen.getByRole("link", { name: /unknown param product/i }),
    ).toBeInTheDocument();
  });
});
