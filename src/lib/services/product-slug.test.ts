import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { generateUniqueProductSlug } from "@/lib/services/product-slug";

// Integration tests against a real Postgres, same pattern as
// products.test.ts.

describe("generateUniqueProductSlug", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("slugifies the name when nothing collides", async () => {
    const slug = await generateUniqueProductSlug("Test Slug Fresh Name");
    expect(slug).toBe("test-slug-fresh-name");
  });

  it("appends -2 when the plain slug is already taken", async () => {
    const existing = await createProduct({
      slug: "test-slug-collide-once",
      name: "Test Slug Collide Once",
    });
    insertedIds.push(existing.id);

    const slug = await generateUniqueProductSlug("Test Slug Collide Once");
    expect(slug).toBe("test-slug-collide-once-2");
  });

  it("keeps incrementing past a taken -2 suffix", async () => {
    const first = await createProduct({
      slug: "test-slug-collide-twice",
      name: "Test Slug Collide Twice",
    });
    insertedIds.push(first.id);
    const second = await createProduct({
      slug: "test-slug-collide-twice-2",
      name: "Test Slug Collide Twice 2",
    });
    insertedIds.push(second.id);

    const slug = await generateUniqueProductSlug("Test Slug Collide Twice");
    expect(slug).toBe("test-slug-collide-twice-3");
  });

  it("does not self-collide when editing a product without changing its name", async () => {
    const existing = await createProduct({
      slug: "test-slug-self-edit",
      name: "Test Slug Self Edit",
    });
    insertedIds.push(existing.id);

    const slug = await generateUniqueProductSlug("Test Slug Self Edit", {
      excludeProductId: existing.id,
    });
    expect(slug).toBe("test-slug-self-edit");
  });

  it("still collides against a different product's slug while editing", async () => {
    const other = await createProduct({
      slug: "test-slug-other-taken",
      name: "Test Slug Other Taken",
    });
    insertedIds.push(other.id);
    const editing = await createProduct({
      slug: "test-slug-being-edited",
      name: "Test Slug Being Edited",
    });
    insertedIds.push(editing.id);

    const slug = await generateUniqueProductSlug("Test Slug Other Taken", {
      excludeProductId: editing.id,
    });
    expect(slug).toBe("test-slug-other-taken-2");
  });

  it("prefers a manual slug override over the derived name slug", async () => {
    const slug = await generateUniqueProductSlug("Some Long Product Name", {
      manualSlug: "custom-override",
    });
    expect(slug).toBe("custom-override");
  });

  it("still runs collision handling against a manual override", async () => {
    const existing = await createProduct({
      slug: "test-slug-manual-collide",
      name: "Whatever Name",
    });
    insertedIds.push(existing.id);

    const slug = await generateUniqueProductSlug("Different Name", {
      manualSlug: "test-slug-manual-collide",
    });
    expect(slug).toBe("test-slug-manual-collide-2");
  });
});
