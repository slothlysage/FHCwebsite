import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { inventoryMovements, variantStock } from "@/lib/db/schema";

type Movement = typeof inventoryMovements.$inferSelect;
type NewMovement = typeof inventoryMovements.$inferInsert;

export async function recordMovement(input: NewMovement): Promise<Movement> {
  const [movement] = await db
    .insert(inventoryMovements)
    .values(input)
    .returning();
  return movement!;
}

export async function getStockForVariant(variantId: string): Promise<number> {
  const [row] = await db
    .select()
    .from(variantStock)
    .where(eq(variantStock.variantId, variantId));
  return row?.stock ?? 0;
}

export async function getStockForVariants(
  variantIds: string[],
): Promise<Map<string, number>> {
  const stock = new Map<string, number>();
  if (variantIds.length === 0) {
    return stock;
  }

  for (const variantId of variantIds) {
    stock.set(variantId, 0);
  }

  const rows = await db
    .select()
    .from(variantStock)
    .where(inArray(variantStock.variantId, variantIds));

  for (const row of rows) {
    stock.set(row.variantId, row.stock);
  }

  return stock;
}
