// Syncs a discount_codes row to a persistent Stripe Coupon so checkout.ts
// (3.8c) can pass a stable `discounts: [{coupon}]` id to a Checkout Session
// instead of creating a fresh Coupon per checkout. Mirrors
// stripe-catalog-sync.ts's variant->Price pattern (specs/05-payments.md,
// "Implementation notes (3.2b)") but for discount_codes->Coupon, with one
// structural difference: Coupons have no `active` toggle to archive — an
// out-of-date one is simply abandoned (Stripe coupons are cheap, unlisted
// objects; there is no dashboard clutter concern the way stray Products/
// Prices caused in 3.2b's incident, see fix_plan.md's "Blocked — needs
// human").
import type Stripe from "stripe";

import { setDiscountCodeStripeCouponId } from "@/lib/repos/discount-codes";
import { stripe } from "@/lib/stripe/client";

type SyncableDiscountCode = {
  id: string;
  kind: "percent" | "fixed";
  value: number;
  stripeCouponId: string | null;
};

// Same "not found = treat as never synced" contract as
// stripe-catalog-sync.ts's fetchStripePrice.
async function fetchStripeCoupon(id: string): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "resource_missing"
    ) {
      return null;
    }
    throw error;
  }
}

function matchesCurrentValue(
  coupon: Stripe.Coupon,
  discountCode: SyncableDiscountCode,
): boolean {
  return discountCode.kind === "percent"
    ? coupon.percent_off === discountCode.value
    : coupon.amount_off === discountCode.value && coupon.currency === "usd";
}

// Returns a Stripe Coupon id that reflects `discountCode`'s current
// kind/value — reusing the cached `stripeCouponId` when it still matches,
// creating (and caching) a new one otherwise. Coupons are immutable once
// created (percent_off/amount_off can't be updated), so a code whose value
// changed since it was last synced gets a brand-new Coupon, not a patched
// one.
export async function ensureStripeCoupon(
  discountCode: SyncableDiscountCode,
): Promise<string> {
  const existing = discountCode.stripeCouponId
    ? await fetchStripeCoupon(discountCode.stripeCouponId)
    : null;
  if (existing && matchesCurrentValue(existing, discountCode)) {
    return existing.id;
  }

  const params: Stripe.CouponCreateParams =
    discountCode.kind === "percent"
      ? { percent_off: discountCode.value, duration: "once" }
      : { amount_off: discountCode.value, currency: "usd", duration: "once" };

  const coupon = await stripe.coupons.create(params, {
    idempotencyKey: `discount-coupon-create-${discountCode.id}-${discountCode.kind}-${discountCode.value}`,
  });
  await setDiscountCodeStripeCouponId(discountCode.id, coupon.id);
  return coupon.id;
}
