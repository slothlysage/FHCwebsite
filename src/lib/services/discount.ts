// Server-side discount code validation (specs/05-payments.md, task 3.8a).
// Pure decision logic over a repo read — no cart/order mutation here. A
// caller re-runs this on every apply/re-price rather than trusting a
// previously-applied result, the same "never trust stored state" rule
// getCartSummary already follows for stock/price (src/lib/services/cart.ts).
import { getDiscountCodeByCode } from "@/lib/repos/discount-codes";

export type DiscountValidationResult =
  | { ok: true; discountCodeId: string; discountCents: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "inactive"
        | "not_started"
        | "expired"
        | "exhausted"
        | "min_spend_not_met";
    };

// Just the reason-string half of the union, for callers (cart.ts's
// "discount_removed" adjustment) that only ever see the rejection branch.
export type DiscountRejectReason = Extract<
  DiscountValidationResult,
  { ok: false }
>["reason"];

export async function validateDiscountCode(
  code: string,
  subtotalCents: number,
): Promise<DiscountValidationResult> {
  const discountCode = await getDiscountCodeByCode(code);
  if (!discountCode) {
    return { ok: false, reason: "not_found" };
  }

  if (!discountCode.isActive) {
    return { ok: false, reason: "inactive" };
  }

  const now = new Date();
  if (discountCode.startsAt && now < discountCode.startsAt) {
    return { ok: false, reason: "not_started" };
  }
  if (discountCode.endsAt && now > discountCode.endsAt) {
    return { ok: false, reason: "expired" };
  }

  if (
    discountCode.maxUses !== null &&
    discountCode.timesUsed >= discountCode.maxUses
  ) {
    return { ok: false, reason: "exhausted" };
  }

  if (
    discountCode.minSpendCents !== null &&
    subtotalCents < discountCode.minSpendCents
  ) {
    return { ok: false, reason: "min_spend_not_met" };
  }

  const rawDiscountCents =
    discountCode.kind === "percent"
      ? Math.round((subtotalCents * discountCode.value) / 100)
      : discountCode.value;

  // Never exceed the subtotal (a fixed-amount code larger than the cart) and
  // never go negative — money floor, per AGENT.md's "Money" section.
  const discountCents = Math.min(Math.max(rawDiscountCents, 0), subtotalCents);

  return { ok: true, discountCodeId: discountCode.id, discountCents };
}
