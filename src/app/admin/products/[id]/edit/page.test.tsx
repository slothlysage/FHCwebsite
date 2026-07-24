import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

const csrfCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@/lib/auth/csrf-cookie", () => ({
  readCsrfCookie: vi.fn(async () => csrfCookie.token),
}));

import { db } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";

import EditProductPage from "./page";

// An async Server Component, invoked and awaited directly — same pattern as
// the product detail page test's `withParams` helper. The actual update
// logic is covered end-to-end by admin-products.test.ts; this file only
// covers what the page renders around ProductForm and the not-found case.

function withParams(id: string) {
  return EditProductPage({ params: Promise.resolve({ id }) });
}

describe("EditProductPage", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("renders the product's current values, pre-filled", async () => {
    const product = await createProduct({
      slug: "test-edit-page-prefill",
      name: "Prefill Candle",
      description: "Smells nice.",
    });
    insertedIds.push(product.id);

    render(await withParams(product.id));

    expect(screen.getByLabelText("Name")).toHaveValue("Prefill Candle");
    expect(screen.getByLabelText("Slug")).toHaveValue("test-edit-page-prefill");
    expect(screen.getByLabelText("Description")).toHaveValue("Smells nice.");
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("shows a Publish button for a draft product and an Unpublish button for a published one", async () => {
    const draft = await createProduct({
      slug: "test-edit-page-status-draft",
      name: "Draft Candle",
    });
    insertedIds.push(draft.id);
    render(await withParams(draft.id));
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete product" }),
    ).toBeInTheDocument();

    const published = await createProduct({
      slug: "test-edit-page-status-published",
      name: "Published Candle",
      status: "published",
    });
    insertedIds.push(published.id);
    render(await withParams(published.id));
    expect(
      screen.getByRole("button", { name: "Unpublish" }),
    ).toBeInTheDocument();
  });

  it("renders existing variants and an add-variant form", async () => {
    const product = await createProduct({
      slug: "test-edit-page-variants",
      name: "Variant Candle",
    });
    insertedIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: "FC-TEST-EDIT-PAGE-001",
      name: "Balsam Fir",
      priceCents: 2499,
      weightGrams: 340,
    });

    render(await withParams(product.id));

    expect(screen.getByText("FC-TEST-EDIT-PAGE-001")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add variant" }),
    ).toBeInTheDocument();
  });

  it("rejects (404s) for an unknown product id", async () => {
    await expect(
      withParams("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });

  it("has no axe violations", async () => {
    const product = await createProduct({
      slug: "test-edit-page-axe",
      name: "Axe Candle",
    });
    insertedIds.push(product.id);

    const { container } = render(await withParams(product.id));
    expect(await axe(container)).toHaveNoViolations();
  });
});
