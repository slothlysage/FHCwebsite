import { eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { discountCodes } from "@/lib/db/schema";

type DiscountCode = typeof discountCodes.$inferSelect;

// Case-insensitive lookup against the same `lower(code)` shape as the
// schema's uniqueIndex (specs/02-data-model.md's "Implementation notes
// (1.1)") — comparing `lower(column) = lower(input)` rather than trusting
// caller-normalized input.
export async function getDiscountCodeByCode(
  code: string,
): Promise<DiscountCode | undefined> {
  const [row] = await db
    .select()
    .from(discountCodes)
    .where(eq(sql`lower(${discountCodes.code})`, code.toLowerCase()));
  return row;
}

// Atomic `times_used + 1` (not read-then-write) so concurrent redemptions of
// the same code can't lose an increment.
export async function incrementDiscountCodeUsage(
  id: string,
  executor: DbExecutor = db,
): Promise<DiscountCode> {
  const [updated] = await executor
    .update(discountCodes)
    .set({ timesUsed: sql`${discountCodes.timesUsed} + 1` })
    .where(eq(discountCodes.id, id))
    .returning();
  return updated!;
}
