import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { productVariants } from "@/lib/db/schema";

type Variant = typeof productVariants.$inferSelect;
type NewVariant = typeof productVariants.$inferInsert;

export async function createVariant(input: NewVariant): Promise<Variant> {
  const [variant] = await db.insert(productVariants).values(input).returning();
  return variant!;
}

export async function getVariantById(id: string): Promise<Variant | undefined> {
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id));
  return variant;
}

export async function listVariantsByProductId(
  productId: string,
): Promise<Variant[]> {
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
}

export async function listActiveVariantsByProductId(
  productId: string,
): Promise<Variant[]> {
  return db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        eq(productVariants.isActive, true),
      ),
    );
}

export async function updateVariant(
  id: string,
  patch: Partial<NewVariant>,
): Promise<Variant | undefined> {
  const [updated] = await db
    .update(productVariants)
    .set(patch)
    .where(eq(productVariants.id, id))
    .returning();
  return updated;
}

export async function deactivateVariant(
  id: string,
): Promise<Variant | undefined> {
  const [deactivated] = await db
    .update(productVariants)
    .set({ isActive: false })
    .where(eq(productVariants.id, id))
    .returning();
  return deactivated;
}
