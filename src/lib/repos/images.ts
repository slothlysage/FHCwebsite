import { eq } from "drizzle-orm";

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
