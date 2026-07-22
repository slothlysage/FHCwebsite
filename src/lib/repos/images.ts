import { eq, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { productImages } from "@/lib/db/schema";

type Image = typeof productImages.$inferSelect;
type NewImage = typeof productImages.$inferInsert;

// Replaces the full image set for a product: delete-then-reinsert, rather
// than diffing individual rows. `product_images` has no natural unique key
// to upsert on (a re-imported URL isn't guaranteed stable), and this keeps
// re-running an import idempotent — the end state is always exactly the
// images just passed in, never a growing duplicate list.
export async function replaceProductImages(
  productId: string,
  images: Array<Omit<NewImage, "productId">>,
  executor: DbExecutor = db,
): Promise<Image[]> {
  await executor
    .delete(productImages)
    .where(eq(productImages.productId, productId));

  if (images.length === 0) {
    return [];
  }

  return executor
    .insert(productImages)
    .values(images.map((image) => ({ ...image, productId })))
    .returning();
}

// One image per product — the lowest `position` — for listing pages that
// show a single thumbnail. `selectDistinctOn` requires its `orderBy` to lead
// with the same column(s) it's distinct-ing on (product_id), so within-group
// ordering by position comes second.
export async function listPrimaryImagesByProductIds(
  productIds: string[],
): Promise<Map<string, Image>> {
  const primaryImages = new Map<string, Image>();
  if (productIds.length === 0) {
    return primaryImages;
  }

  const rows = await db
    .selectDistinctOn([productImages.productId])
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(productImages.productId, productImages.position);

  for (const row of rows) {
    primaryImages.set(row.productId, row);
  }

  return primaryImages;
}
