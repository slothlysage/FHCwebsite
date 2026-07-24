import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { listAdminProducts } from "@/lib/services/admin-product-listing";

// Integration tests against a real Postgres (specs/06-testing.md).

describe("listAdminProducts", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("returns every matching product with its variant SKUs attached", async () => {
    const name = `Admin Listing Test ${randomUUID()}`;
    const product = await createProduct({
      slug: `test-admin-listing-${randomUUID()}`,
      name,
      status: "published",
    });
    insertedIds.push(product.id);
    await createVariant({
      productId: product.id,
      sku: `TEST-ADMIN-LISTING-${randomUUID()}`,
      name: "Default",
      priceCents: 1500,
      weightGrams: 100,
    });

    const items = await listAdminProducts({ search: name, status: undefined });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: product.id,
      slug: product.slug,
      name,
      status: "published",
    });
    expect(items[0]?.skus).toHaveLength(1);
  });

  it("returns an empty array when nothing matches", async () => {
    const items = await listAdminProducts({
      search: `no-such-product-${randomUUID()}`,
      status: undefined,
    });
    expect(items).toEqual([]);
  });

  it("returns an empty sku list for a product with no variants", async () => {
    const product = await createProduct({
      slug: `test-admin-listing-no-variants-${randomUUID()}`,
      name: `No Variants ${randomUUID()}`,
    });
    insertedIds.push(product.id);

    const items = await listAdminProducts({
      search: product.name,
      status: undefined,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.skus).toEqual([]);
  });

  it("filters by status", async () => {
    const draft = await createProduct({
      slug: `test-admin-listing-status-${randomUUID()}`,
      name: `Status Filter Test ${randomUUID()}`,
      status: "draft",
    });
    insertedIds.push(draft.id);

    const items = await listAdminProducts({
      search: undefined,
      status: "published",
    });

    expect(items.map((item) => item.id)).not.toContain(draft.id);
  });
});
