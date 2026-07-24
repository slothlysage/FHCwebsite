import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { discountCodes } from "@/lib/db/schema";
import { validateDiscountCode } from "@/lib/services/discount";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("validateDiscountCode", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
    }
  });

  async function insertCode(
    overrides: Partial<typeof discountCodes.$inferInsert>,
  ) {
    const [created] = await db
      .insert(discountCodes)
      .values({
        code: "TESTCODE",
        kind: "percent",
        value: 10,
        ...overrides,
      })
      .returning();
    insertedIds.push(created!.id);
    return created!;
  }

  it("accepts a valid percent code and rounds the discount", async () => {
    const code = await insertCode({
      code: "PCT10",
      kind: "percent",
      value: 10,
    });

    const result = await validateDiscountCode("PCT10", 999);

    expect(result).toEqual({
      ok: true,
      discountCodeId: code.id,
      discountCents: 100, // round(999 * 10 / 100) = round(99.9)
    });
  });

  it("accepts a valid fixed code", async () => {
    const code = await insertCode({
      code: "FIVEOFF",
      kind: "fixed",
      value: 500,
    });

    const result = await validateDiscountCode("FIVEOFF", 2000);

    expect(result).toEqual({
      ok: true,
      discountCodeId: code.id,
      discountCents: 500,
    });
  });

  it("caps a fixed discount at the subtotal, never going negative", async () => {
    await insertCode({ code: "BIGFIXED", kind: "fixed", value: 5000 });

    const result = await validateDiscountCode("BIGFIXED", 1000);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, discountCents: 1000 }),
    );
  });

  it("is case-insensitive", async () => {
    await insertCode({ code: "MixedCase", kind: "percent", value: 5 });

    const result = await validateDiscountCode("mixedcase", 1000);

    expect(result.ok).toBe(true);
  });

  it("rejects a code that doesn't exist", async () => {
    const result = await validateDiscountCode("DOES_NOT_EXIST", 1000);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an inactive code", async () => {
    await insertCode({ code: "OFFCODE", isActive: false });

    const result = await validateDiscountCode("OFFCODE", 1000);
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });

  it("rejects a code that hasn't started yet", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await insertCode({ code: "FUTURECODE", startsAt: future });

    const result = await validateDiscountCode("FUTURECODE", 1000);
    expect(result).toEqual({ ok: false, reason: "not_started" });
  });

  it("rejects an expired code", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await insertCode({ code: "OLDCODE", endsAt: past });

    const result = await validateDiscountCode("OLDCODE", 1000);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an exhausted code", async () => {
    await insertCode({ code: "USEDUP", maxUses: 3, timesUsed: 3 });

    const result = await validateDiscountCode("USEDUP", 1000);
    expect(result).toEqual({ ok: false, reason: "exhausted" });
  });

  it("rejects a subtotal below the minimum spend", async () => {
    await insertCode({ code: "MINSPEND", minSpendCents: 5000 });

    const result = await validateDiscountCode("MINSPEND", 4999);
    expect(result).toEqual({ ok: false, reason: "min_spend_not_met" });
  });

  it("accepts a subtotal at exactly the minimum spend", async () => {
    await insertCode({ code: "MINSPEND2", minSpendCents: 5000 });

    const result = await validateDiscountCode("MINSPEND2", 5000);
    expect(result.ok).toBe(true);
  });
});
