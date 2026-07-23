import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { productAttributes, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import {
  listAttributesByProductId,
  listFilterableAttributeValues,
  setProductAttribute,
} from "@/lib/repos/attributes";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("attributes repo", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productAttributes)
        .where(eq(productAttributes.productId, productId));
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

  it("sets an attribute on a product", async () => {
    const product = await makeProduct("test-attr-set");

    const attribute = await setProductAttribute(
      product.id,
      "scent",
      "lavender",
    );

    expect(attribute.key).toBe("scent");
    expect(attribute.value).toBe("lavender");
  });

  it("lists distinct values for a key across published products", async () => {
    const a = await makeProduct("test-attr-list-a");
    const b = await makeProduct("test-attr-list-b");
    await setProductAttribute(a.id, "scent", "lavender");
    await setProductAttribute(b.id, "scent", "lavender");
    await setProductAttribute(b.id, "scent", "vanilla");

    const values = await listFilterableAttributeValues("scent");

    expect(values).toEqual(["lavender", "vanilla"]);
  });

  it("excludes values that only belong to unpublished products", async () => {
    const draft = await makeProduct("test-attr-draft", "draft");
    await setProductAttribute(draft.id, "scent", "draft-only-scent");

    const values = await listFilterableAttributeValues("scent");

    expect(values).not.toContain("draft-only-scent");
  });

  it("returns an empty array for a key with no values", async () => {
    const values = await listFilterableAttributeValues("no-such-key-anywhere");
    expect(values).toEqual([]);
  });

  it("lists every attribute for a product regardless of key", async () => {
    const product = await makeProduct("test-attr-list-by-product");
    await setProductAttribute(product.id, "scent", "lavender");
    await setProductAttribute(product.id, "burn_time", "40 hours");

    const attributes = await listAttributesByProductId(product.id);

    expect(attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "scent", value: "lavender" }),
        expect.objectContaining({ key: "burn_time", value: "40 hours" }),
      ]),
    );
    expect(attributes).toHaveLength(2);
  });

  it("returns an empty array for a product with no attributes", async () => {
    const product = await makeProduct("test-attr-list-by-product-none");

    const attributes = await listAttributesByProductId(product.id);

    expect(attributes).toEqual([]);
  });
});
