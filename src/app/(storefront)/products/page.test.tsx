import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import ProductsPage from "./page";

// Integration test against a real Postgres (specs/06-testing.md) — the page
// is an async Server Component, so it's invoked directly and awaited rather
// than passed to render() as a JSX element.

describe("ProductsPage", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
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

    render(await ProductsPage());

    expect(
      screen.getByRole("link", { name: /published product/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /draft product/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a page heading", async () => {
    render(await ProductsPage());
    expect(screen.getByRole("heading", { name: /shop/i })).toBeInTheDocument();
  });
});
