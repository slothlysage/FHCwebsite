import { and, eq, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { productAttributes, products } from "@/lib/db/schema";

type Attribute = typeof productAttributes.$inferSelect;

// Open-ended filter facets (scent=lavender, size=8oz, ...) — see
// specs/02-data-model.md. No update/delete yet; nothing in the current
// fix_plan needs to change an attribute after it's set (4.3/4.4 admin CRUD
// will, when it lands).
export async function setProductAttribute(
  productId: string,
  key: string,
  value: string,
  executor: DbExecutor = db,
): Promise<Attribute> {
  const [attribute] = await executor
    .insert(productAttributes)
    .values({ productId, key, value })
    .returning();
  return attribute!;
}

// Distinct values for one facet key, scoped to published/non-deleted
// products only — this is what populates the storefront filter UI's
// checkbox options (2.3), so a scent/size with no live product behind it
// never shows up as a selectable-but-empty filter.
export async function listFilterableAttributeValues(
  key: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: productAttributes.value })
    .from(productAttributes)
    .innerJoin(products, eq(products.id, productAttributes.productId))
    .where(
      and(
        eq(productAttributes.key, key),
        eq(products.status, "published"),
        isNull(products.deletedAt),
      ),
    )
    .orderBy(productAttributes.value);

  return rows.map((row) => row.value);
}

// Replaces the full attribute set for a product: delete-then-reinsert,
// mirroring `replaceProductImages` (images.ts) — `product_attributes` has no
// natural unique key to upsert on, and this keeps re-running the catalog
// importer idempotent regardless of whether option values changed between
// runs, not just whether they're identical.
export async function replaceProductAttributes(
  productId: string,
  attributes: Array<{ key: string; value: string }>,
  executor: DbExecutor = db,
): Promise<Attribute[]> {
  await executor
    .delete(productAttributes)
    .where(eq(productAttributes.productId, productId));

  if (attributes.length === 0) {
    return [];
  }

  return executor
    .insert(productAttributes)
    .values(attributes.map((attribute) => ({ ...attribute, productId })))
    .returning();
}

// Every attribute row for one product, regardless of key — the product-
// detail page (2.5) groups these by key (scent, size, burn_time, ...) to
// display whichever open-ended facets a given product actually has.
export async function listAttributesByProductId(
  productId: string,
): Promise<Attribute[]> {
  return db
    .select()
    .from(productAttributes)
    .where(eq(productAttributes.productId, productId))
    .orderBy(productAttributes.key);
}
