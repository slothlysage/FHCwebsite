import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { productImages, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { replaceProductImages } from "@/lib/repos/images";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("images repo", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productImages)
        .where(eq(productImages.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeProduct(slug: string) {
    const product = await createProduct({ slug, name: slug });
    insertedProductIds.push(product.id);
    return product;
  }

  it("inserts images for a product with none yet", async () => {
    const product = await makeProduct("test-images-insert");

    const images = await replaceProductImages(product.id, [
      {
        url: "https://example.com/a.jpg",
        altText: "A",
        position: 1,
        width: 0,
        height: 0,
      },
      {
        url: "https://example.com/b.jpg",
        altText: "B",
        position: 2,
        width: 0,
        height: 0,
      },
    ]);

    expect(images).toHaveLength(2);
    const stored = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id));
    expect(stored).toHaveLength(2);
  });

  it("replaces the existing image set rather than appending to it", async () => {
    const product = await makeProduct("test-images-replace");

    await replaceProductImages(product.id, [
      {
        url: "https://example.com/old.jpg",
        altText: "Old",
        position: 1,
        width: 0,
        height: 0,
      },
    ]);
    const replaced = await replaceProductImages(product.id, [
      {
        url: "https://example.com/new.jpg",
        altText: "New",
        position: 1,
        width: 0,
        height: 0,
      },
    ]);

    expect(replaced).toHaveLength(1);
    const stored = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.url).toBe("https://example.com/new.jpg");
  });

  it("clears all images when passed an empty array", async () => {
    const product = await makeProduct("test-images-clear");

    await replaceProductImages(product.id, [
      {
        url: "https://example.com/only.jpg",
        altText: "Only",
        position: 1,
        width: 0,
        height: 0,
      },
    ]);
    const cleared = await replaceProductImages(product.id, []);

    expect(cleared).toEqual([]);
    const stored = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id));
    expect(stored).toHaveLength(0);
  });
});
