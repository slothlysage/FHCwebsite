import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { db } from "@/lib/db/client";
import { discountCodes } from "@/lib/db/schema";
import type { ensureStripeCoupon as EnsureStripeCoupon } from "@/lib/services/stripe-discount-sync";
import {
  getStripeFakeCoupons,
  resetStripeFakeState,
  seedStripeCoupon,
  stripeServer,
} from "../../../tests/msw/stripe-server";

// Integration tests against the real dev database (discount_codes), with
// Stripe intercepted at the network boundary via msw — same rationale and
// same dynamic-import-after-listen() requirement as
// stripe-catalog-sync.test.ts/checkout.test.ts (specs/05-payments.md,
// "Implementation notes (3.2b)").
let ensureStripeCoupon: typeof EnsureStripeCoupon;

beforeAll(async () => {
  stripeServer.listen({ onUnhandledRequest: "error" });
  vi.resetModules();
  ({ ensureStripeCoupon } =
    await import("@/lib/services/stripe-discount-sync"));
});
afterEach(() => {
  stripeServer.resetHandlers();
  resetStripeFakeState();
});
afterAll(() => stripeServer.close());

describe("ensureStripeCoupon", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
    }
  });

  async function makeDiscountCode(patch: {
    code: string;
    kind: "percent" | "fixed";
    value: number;
    stripeCouponId?: string | null;
  }) {
    const [created] = await db
      .insert(discountCodes)
      .values({
        code: patch.code,
        kind: patch.kind,
        value: patch.value,
        stripeCouponId: patch.stripeCouponId ?? null,
      })
      .returning();
    insertedIds.push(created!.id);
    return created!;
  }

  it("creates a percent-off Coupon for a code with no stripeCouponId", async () => {
    const discountCode = await makeDiscountCode({
      code: "SYNC-PCT",
      kind: "percent",
      value: 20,
    });

    const couponId = await ensureStripeCoupon(discountCode);

    const coupon = getStripeFakeCoupons().find((c) => c.id === couponId);
    expect(coupon?.percent_off).toBe(20);
    expect(coupon?.duration).toBe("once");

    const [row] = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.id, discountCode.id));
    expect(row?.stripeCouponId).toBe(couponId);
  });

  it("creates a fixed-amount Coupon for a code with no stripeCouponId", async () => {
    const discountCode = await makeDiscountCode({
      code: "SYNC-FIXED",
      kind: "fixed",
      value: 500,
    });

    const couponId = await ensureStripeCoupon(discountCode);

    const coupon = getStripeFakeCoupons().find((c) => c.id === couponId);
    expect(coupon?.amount_off).toBe(500);
    expect(coupon?.currency).toBe("usd");
  });

  it("reuses an existing Coupon that still matches the code's kind/value", async () => {
    seedStripeCoupon({
      id: "coupon_seed_reuse",
      object: "coupon",
      percent_off: 10,
      amount_off: null,
      currency: null,
      duration: "once",
    });
    const discountCode = await makeDiscountCode({
      code: "SYNC-REUSE",
      kind: "percent",
      value: 10,
      stripeCouponId: "coupon_seed_reuse",
    });

    const couponId = await ensureStripeCoupon(discountCode);

    expect(couponId).toBe("coupon_seed_reuse");
    expect(getStripeFakeCoupons()).toHaveLength(1);
  });

  it("creates a replacement Coupon when the stored one's value no longer matches", async () => {
    seedStripeCoupon({
      id: "coupon_seed_stale",
      object: "coupon",
      percent_off: 10,
      amount_off: null,
      currency: null,
      duration: "once",
    });
    const discountCode = await makeDiscountCode({
      code: "SYNC-STALE",
      kind: "percent",
      value: 25,
      stripeCouponId: "coupon_seed_stale",
    });

    const couponId = await ensureStripeCoupon(discountCode);

    expect(couponId).not.toBe("coupon_seed_stale");
    const coupon = getStripeFakeCoupons().find((c) => c.id === couponId);
    expect(coupon?.percent_off).toBe(25);
  });

  it("treats a stripeCouponId Stripe can't find as create (deleted out-of-band)", async () => {
    const discountCode = await makeDiscountCode({
      code: "SYNC-MISSING",
      kind: "fixed",
      value: 300,
      stripeCouponId: "coupon_does_not_exist",
    });

    const couponId = await ensureStripeCoupon(discountCode);

    expect(couponId).not.toBe("coupon_does_not_exist");
    const coupon = getStripeFakeCoupons().find((c) => c.id === couponId);
    expect(coupon?.amount_off).toBe(300);
  });

  it("propagates a genuine Stripe error instead of treating it as a missing coupon", async () => {
    stripeServer.use(
      http.get("https://api.stripe.com/v1/coupons/:id", () =>
        HttpResponse.json(
          {
            error: {
              type: "api_error",
              code: "lock_timeout",
              message: "try again",
            },
          },
          { status: 500 },
        ),
      ),
    );
    const discountCode = await makeDiscountCode({
      code: "SYNC-ERROR",
      kind: "percent",
      value: 5,
      stripeCouponId: "coupon_seed_error",
    });

    await expect(ensureStripeCoupon(discountCode)).rejects.toThrow(/try again/);
  });

  it("running twice for the same unchanged code creates no duplicate Coupon", async () => {
    const discountCode = await makeDiscountCode({
      code: "SYNC-RERUN",
      kind: "percent",
      value: 15,
    });

    const first = await ensureStripeCoupon(discountCode);
    const [refetched] = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.id, discountCode.id));
    const second = await ensureStripeCoupon(refetched!);

    expect(second).toBe(first);
    expect(getStripeFakeCoupons()).toHaveLength(1);
  });
});
