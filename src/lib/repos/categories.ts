import { and, eq, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { categories, productCategories, products } from "@/lib/db/schema";

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

// Categories linked to at least one published/non-deleted product — this is
// what populates the storefront filter UI's category checkboxes (2.3), so a
// category with nothing live in it never shows up as a selectable-but-empty
// filter.
export async function listFilterableCategories(): Promise<Category[]> {
  return db
    .selectDistinct({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
    })
    .from(categories)
    .innerJoin(
      productCategories,
      eq(productCategories.categoryId, categories.id),
    )
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(and(eq(products.status, "published"), isNull(products.deletedAt)))
    .orderBy(categories.name);
}
