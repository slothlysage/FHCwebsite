import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { categories, productCategories } from "@/lib/db/schema";

type Category = typeof categories.$inferSelect;
type NewCategory = typeof categories.$inferInsert;

export async function getCategoryBySlug(
  slug: string,
  executor: DbExecutor = db,
): Promise<Category | undefined> {
  const [category] = await executor
    .select()
    .from(categories)
    .where(eq(categories.slug, slug));
  return category;
}

export async function createCategory(
  input: NewCategory,
  executor: DbExecutor = db,
): Promise<Category> {
  const [category] = await executor
    .insert(categories)
    .values(input)
    .returning();
  return category!;
}

// Idempotent: re-linking a product to a category it's already linked to is a
// no-op rather than a unique-violation, so re-running an import doesn't fail.
export async function linkProductCategory(
  productId: string,
  categoryId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(productCategories)
    .values({ productId, categoryId })
    .onConflictDoNothing();
}
