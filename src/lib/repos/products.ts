import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";

type Product = typeof products.$inferSelect;
type NewProduct = typeof products.$inferInsert;
type ProductStatus = Product["status"];

export async function createProduct(input: NewProduct): Promise<Product> {
  const [product] = await db.insert(products).values(input).returning();
  return product!;
}

export async function getProductById(id: string): Promise<Product | undefined> {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product;
}

export async function getProductBySlug(
  slug: string,
): Promise<Product | undefined> {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.slug, slug));
  return product;
}

export async function listProducts(options?: {
  status?: ProductStatus;
  includeDeleted?: boolean;
}): Promise<Product[]> {
  const conditions = [];
  if (options?.status) {
    conditions.push(eq(products.status, options.status));
  }
  if (!options?.includeDeleted) {
    conditions.push(isNull(products.deletedAt));
  }

  return db
    .select()
    .from(products)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

export async function updateProduct(
  id: string,
  patch: Partial<NewProduct>,
): Promise<Product | undefined> {
  const [updated] = await db
    .update(products)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return updated;
}

export async function softDeleteProduct(
  id: string,
): Promise<Product | undefined> {
  const [deleted] = await db
    .update(products)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return deleted;
}
