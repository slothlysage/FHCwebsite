import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";

type Variant = typeof productVariants.$inferSelect;
type NewVariant = typeof productVariants.$inferInsert;

export async function createVariant(
  input: NewVariant,
  executor: DbExecutor = db,
): Promise<Variant> {
  const [variant] = await executor
    .insert(productVariants)
    .values(input)
    .returning();
  return variant!;
}

export async function getVariantById(id: string): Promise<Variant | undefined> {
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id));
  return variant;
}

export async function getVariantBySku(
  sku: string,
  executor: DbExecutor = db,
): Promise<Variant | undefined> {
  const [variant] = await executor
    .select()
    .from(productVariants)
    .where(eq(productVariants.sku, sku));
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

// Batch form of listActiveVariantsByProductId for listing pages — one query
// instead of N. A product with no active variants has no key in the
// returned map (mirrors getStockForVariants' "absent means zero" contract
// for the products case: callers must handle a missing key explicitly).
export async function listActiveVariantsByProductIds(
  productIds: string[],
): Promise<Map<string, Variant[]>> {
  const variantsByProduct = new Map<string, Variant[]>();
  if (productIds.length === 0) {
    return variantsByProduct;
  }

  const rows = await db
    .select()
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.productId, productIds),
        eq(productVariants.isActive, true),
      ),
    );

  for (const row of rows) {
    const existing = variantsByProduct.get(row.productId);
    if (existing) {
      existing.push(row);
    } else {
      variantsByProduct.set(row.productId, [row]);
    }
  }

  return variantsByProduct;
}

// Batch form of listVariantsByProductId (every variant, active or not) — for
// the admin products list (4.3b), which needs to show every SKU a product
// has, not just its currently-sellable ones.
export async function listVariantsByProductIds(
  productIds: string[],
): Promise<Map<string, Variant[]>> {
  const variantsByProduct = new Map<string, Variant[]>();
  if (productIds.length === 0) {
    return variantsByProduct;
  }

  const rows = await db
    .select()
    .from(productVariants)
    .where(inArray(productVariants.productId, productIds));

  for (const row of rows) {
    const existing = variantsByProduct.get(row.productId);
    if (existing) {
      existing.push(row);
    } else {
      variantsByProduct.set(row.productId, [row]);
    }
  }

  return variantsByProduct;
}

// Active variants of published, non-deleted products only — the exact scope
// Stripe catalog sync (3.2b) syncs. Carries the product name alongside each
// variant since Stripe's Product display name is derived from it
// (`${productName} — ${variant.name}`), and the calling service has no other
// way to get it without a second query per variant.
export async function listActiveVariantsOfPublishedProducts(): Promise<
  Array<Variant & { productName: string }>
> {
  const rows = await db
    .select({ variant: productVariants, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(
      and(
        eq(productVariants.isActive, true),
        eq(products.status, "published"),
        isNull(products.deletedAt),
      ),
    );

  return rows.map((row) => ({ ...row.variant, productName: row.productName }));
}

export async function updateVariant(
  id: string,
  patch: Partial<NewVariant>,
  executor: DbExecutor = db,
): Promise<Variant | undefined> {
  const [updated] = await executor
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
