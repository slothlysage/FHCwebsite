import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import type { RawSearchParams } from "@/lib/validation/admin-product-filters";
import AdminProductsPage from "./page";

// Integration test against the real dev database (specs/06-testing.md) — an
// async Server Component, invoked and awaited directly, same pattern as
// products/page.test.tsx and the admin login page test.

function withSearchParams(searchParams: RawSearchParams = {}) {
  return AdminProductsPage({ searchParams: Promise.resolve(searchParams) });
}

describe("AdminProductsPage", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("renders a labeled search field and status filter", async () => {
    render(await withSearchParams());

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("links to the new-product screen", async () => {
    render(await withSearchParams());

    expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute(
      "href",
      "/admin/products/new",
    );
  });

  it("links each row to its edit screen", async () => {
    const product = await createProduct({
      slug: "test-admin-products-page-edit-link",
      name: "Admin Page Edit Link Product",
      status: "published",
    });
    insertedIds.push(product.id);

    render(await withSearchParams({ search: "Admin Page Edit Link" }));

    expect(
      screen.getByRole("link", { name: `Edit ${product.name}` }),
    ).toHaveAttribute("href", `/admin/products/${product.id}/edit`);
  });

  it("lists a matching product's name, status, and SKU", async () => {
    const product = await createProduct({
      slug: "test-admin-products-page-match",
      name: "Admin Page Match Product",
      status: "published",
    });
    insertedIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "TEST-ADMIN-PAGE-SKU",
      name: "Default",
      priceCents: 1000,
      weightGrams: 100,
    });

    render(await withSearchParams({ search: "Admin Page Match" }));

    expect(screen.getByText("Admin Page Match Product")).toBeInTheDocument();
    expect(screen.getByText("TEST-ADMIN-PAGE-SKU")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "published" })).toBeInTheDocument();
  });

  it("excludes products that don't match the search term", async () => {
    const product = await createProduct({
      slug: "test-admin-products-page-nonmatch",
      name: "Admin Page Nonmatch Product",
      status: "published",
    });
    insertedIds.push(product.id);

    render(await withSearchParams({ search: "no-such-product-name-anywhere" }));

    expect(
      screen.queryByText("Admin Page Nonmatch Product"),
    ).not.toBeInTheDocument();
  });

  it("filters by status", async () => {
    const draft = await createProduct({
      slug: "test-admin-products-page-status-draft",
      name: "Admin Page Status Draft Product",
      status: "draft",
    });
    insertedIds.push(draft.id);

    render(
      await withSearchParams({
        search: "Admin Page Status Draft Product",
        status: "published",
      }),
    );

    expect(
      screen.queryByText("Admin Page Status Draft Product"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    render(await withSearchParams({ search: "no-such-product-name-at-all" }));

    expect(screen.getByText(/no products/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(await withSearchParams());
    expect(await axe(container)).toHaveNoViolations();
  });
});
