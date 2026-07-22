import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import {
  createProduct,
  getProductById,
  getProductBySlug,
  listProducts,
  softDeleteProduct,
  updateProduct,
} from "@/lib/repos/products";

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
