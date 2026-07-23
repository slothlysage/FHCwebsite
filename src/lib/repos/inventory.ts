import { eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { inventoryMovements, variantStock } from "@/lib/db/schema";

type Movement = typeof inventoryMovements.$inferSelect;
type NewMovement = typeof inventoryMovements.$inferInsert;

export async function recordMovement(
  input: NewMovement,
  executor: DbExecutor = db,
): Promise<Movement> {
  const [movement] = await executor
    .insert(inventoryMovements)
    .values(input)
    .returning();
  return movement!;
}

// Serializes concurrent fulfillment of the same variant so a webhook-time
// stock recheck (specs/05-payments.md's "Oversell" section, task 3.6) isn't
// itself racy: `pg_advisory_xact_lock` blocks until any other transaction
// holding the same key commits or rolls back, and releases automatically at
// this transaction's end — no separate unlock call, no lock row to clean up.
// `variant_stock` is an aggregate view, not a real table, so `SELECT ...
// FOR UPDATE` isn't an option here (Postgres rejects locking clauses on
// aggregates); an advisory lock keyed on the variant id is the standard
// substitute. Must be called with the transaction's own executor, not the
// module-level `db` — the lock is scoped to whichever connection takes it.
export async function lockVariantStock(
  variantId: string,
  executor: DbExecutor,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${variantId}))`,
  );
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
