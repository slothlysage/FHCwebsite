import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import sitemap from "./sitemap";

// Integration test against a real Postgres (specs/06-testing.md) — sitemap()
// is a plain async function (Next's MetadataRoute.Sitemap convention), so
// it's invoked and awaited directly like the async Server Component tests.

describe("sitemap", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("lists the static routes", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("http://localhost:3000");
    expect(urls).toContain("http://localhost:3000/products");
  });

  it("lists every published, non-deleted product and none draft/archived/deleted", async () => {
    const published = await createProduct({
      slug: `sitemap-published-${crypto.randomUUID()}`,
      name: "Published",
      status: "published",
    });
    insertedIds.push(published.id);

    const draft = await createProduct({
      slug: `sitemap-draft-${crypto.randomUUID()}`,
      name: "Draft",
      status: "draft",
    });
    insertedIds.push(draft.id);

    const archived = await createProduct({
      slug: `sitemap-archived-${crypto.randomUUID()}`,
      name: "Archived",
      status: "archived",
    });
    insertedIds.push(archived.id);

    const deleted = await createProduct({
      slug: `sitemap-deleted-${crypto.randomUUID()}`,
      name: "Deleted",
      status: "published",
      deletedAt: new Date(),
    });
    insertedIds.push(deleted.id);

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`http://localhost:3000/products/${published.slug}`);
    expect(urls).not.toContain(`http://localhost:3000/products/${draft.slug}`);
    expect(urls).not.toContain(
      `http://localhost:3000/products/${archived.slug}`,
    );
    expect(urls).not.toContain(
      `http://localhost:3000/products/${deleted.slug}`,
    );
  });

  it("builds product URLs without query strings", async () => {
    const published = await createProduct({
      slug: `sitemap-clean-${crypto.randomUUID()}`,
      name: "Clean URL",
      status: "published",
    });
    insertedIds.push(published.id);

    const entries = await sitemap();
    const entry = entries.find((e) =>
      e.url.endsWith(`/products/${published.slug}`),
    );

    expect(entry).toBeDefined();
    expect(entry?.url).not.toContain("?");
  });
});
