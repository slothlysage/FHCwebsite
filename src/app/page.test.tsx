import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import Home from "./page";

// Integration test against a real Postgres (specs/06-testing.md) — an async
// Server Component, so it's invoked directly and awaited rather than passed
// to render() as a JSX element (same pattern as products/page.test.tsx).

describe("Home", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("renders the site heading and no longer says 'under construction'", async () => {
    render(await Home());
    expect(
      screen.getByRole("heading", { name: "Fasthorse Creations" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/under construction/i)).not.toBeInTheDocument();
  });

  it("links through to the full product listing", async () => {
    render(await Home());
    expect(
      screen.getByRole("link", { name: /shop all products/i }),
    ).toHaveAttribute("href", "/products");
  });

  it("renders a featured-products section fed by the live catalog", async () => {
    const published = await createProduct({
      slug: "test-home-featured",
      name: "Home Featured Product",
      status: "published",
    });
    insertedIds.push(published.id);

    render(await Home());

    const link = screen.getByRole("link", { name: /home featured product/i });
    expect(link).toHaveAttribute("href", "/products/test-home-featured");
  });

  it("excludes draft products from the featured section", async () => {
    const draft = await createProduct({
      slug: "test-home-featured-draft",
      name: "Home Featured Draft",
      status: "draft",
    });
    insertedIds.push(draft.id);

    render(await Home());

    expect(
      screen.queryByRole("link", { name: /home featured draft/i }),
    ).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(await Home());
    expect(await axe(container)).toHaveNoViolations();
  });
});
