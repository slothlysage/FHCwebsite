import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { discountCodes } from "@/lib/db/schema";
import {
  getDiscountCodeByCode,
  getDiscountCodeById,
  incrementDiscountCodeUsage,
} from "@/lib/repos/discount-codes";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("discount-codes repo", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
    }
  });

  it("finds a code by exact match", async () => {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "SAVE10", kind: "percent", value: 10 })
      .returning();
    insertedIds.push(created!.id);

    const found = await getDiscountCodeByCode("SAVE10");
    expect(found?.id).toBe(created!.id);
  });

  it("finds a code case-insensitively", async () => {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "WinterSale", kind: "fixed", value: 500 })
      .returning();
    insertedIds.push(created!.id);

    const found = await getDiscountCodeByCode("wintersale");
    expect(found?.id).toBe(created!.id);
  });

  it("returns undefined for a code that doesn't exist", async () => {
    const found = await getDiscountCodeByCode("NOPE_NOT_A_CODE");
    expect(found).toBeUndefined();
  });

  it("finds a code by id", async () => {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "BYID", kind: "fixed", value: 250 })
      .returning();
    insertedIds.push(created!.id);

    const found = await getDiscountCodeById(created!.id);
    expect(found?.code).toBe("BYID");
  });

  it("returns undefined for an id that doesn't exist", async () => {
    const found = await getDiscountCodeById(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(found).toBeUndefined();
  });

  it("increments times_used atomically", async () => {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "COUNTME", kind: "percent", value: 5, timesUsed: 2 })
      .returning();
    insertedIds.push(created!.id);

    const updated = await incrementDiscountCodeUsage(created!.id);
    expect(updated.timesUsed).toBe(3);

    const [row] = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.id, created!.id));
    expect(row?.timesUsed).toBe(3);
  });
});
