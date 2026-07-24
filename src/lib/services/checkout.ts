// Builds a Stripe Checkout Session from the server-side cart (specs/
// 05-payments.md's "Checkout session" section). Deliberately takes only a
// `cartId` (sourced from the httpOnly cart cookie, never the client) and an
// `idempotencyKey` (caller-derived — see src/lib/actions/checkout.ts) — there
// is no code path here that reads a price, quantity, or total from a client
// payload, which is what makes the "tampered client payload" AC true by
// construction rather than by validation.
import { getDiscountCodeById } from "@/lib/repos/discount-codes";
import { getCartSummary } from "@/lib/services/cart";
import { ensureStripeCoupon } from "@/lib/services/stripe-discount-sync";
import { stripe } from "@/lib/stripe/client";
import { env } from "@/lib/env";

// No shipping-rate admin/config exists yet (that lands with 4.x's Settings
// page per specs/04-admin.md) — these are static, weight-banded flat rates
// so 3.3b can ship a real, working checkout without inventing that admin
// surface, or a live per-address Shippo rate call, early (see
// specs/09-shipping.md's "Why checkout can't do live per-address rating").
// Placeholder amounts, logged under fix_plan.md's "Blocked — needs human"
// for the owner to confirm/replace with real numbers eyeballed off Shippo's
// published USPS rate card once that account exists.
// `maxWeightGrams: null` means "no upper bound" — the last band always
// matches, so `selectShippingBand` never falls through with no match.
type ShippingBand = {
  maxWeightGrams: number | null;
  amountCents: number;
  displayName: string;
};

const SHIPPING_BANDS: ShippingBand[] = [
  {
    maxWeightGrams: 454, // under 1 lb
    amountCents: 500,
    displayName: "Standard shipping (under 1 lb)",
  },
  {
    maxWeightGrams: 1361, // 1-3 lb
    amountCents: 800,
    displayName: "Standard shipping (1-3 lb)",
  },
  {
    maxWeightGrams: null, // 3+ lb
    amountCents: 1200,
    displayName: "Standard shipping (3+ lb)",
  },
];

// Picks the first band whose ceiling the total cart weight doesn't exceed.
// The last band's `maxWeightGrams: null` always matches, so the `find` can
// never return undefined for any input, including 0 (an
// unreachable-in-practice empty cart, but AC requires it not crash) — the
// non-null assertion reflects that guarantee rather than hiding a real gap.
function selectShippingBand(totalWeightGrams: number): ShippingBand {
  return SHIPPING_BANDS.find(
    (band) =>
      band.maxWeightGrams === null || totalWeightGrams <= band.maxWeightGrams,
  )!;
}

export type CreateCheckoutSessionResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; reason: "empty_cart" | "unavailable" };

// `getCartSummary` already re-fetches every variant, re-checks is_active/
// stock, and re-prices from the database (specs/03-storefront.md: "3.3
// (checkout) should call getCartSummary for its line totals rather than
// re-deriving pricing/stock a third way") — this function's only remaining
// job is turning that server-computed summary into Stripe params.
export async function createCheckoutSession(
  cartId: string,
  options: { idempotencyKey: string },
): Promise<CreateCheckoutSessionResult> {
  const summary = await getCartSummary(cartId);

  if (summary.lines.length === 0) {
    return { ok: false, reason: "empty_cart" };
  }

  // Every purchasable variant maps to a Stripe Price via 3.2's catalog sync
  // (specs/05-payments.md's "Sync" section). Referencing that Price by id
  // rather than reconstructing a `price_data` line item from
  // `line.priceCents` means the amount charged is whatever Stripe already
  // has on file for that Price — not a number this function ever computes
  // or a client could ever reach.
  const lineItems: Array<{ price: string; quantity: number }> = [];
  let totalWeightGrams = 0;
  for (const line of summary.lines) {
    if (!line.stripePriceId) {
      return { ok: false, reason: "unavailable" };
    }
    lineItems.push({ price: line.stripePriceId, quantity: line.quantity });
    totalWeightGrams += line.weightGrams * line.quantity;
  }

  const shippingBand = selectShippingBand(totalWeightGrams);

  // A cart's applied discount code (task 3.8b) is synced to a persistent
  // Stripe Coupon (3.8c, stripe-discount-sync.ts) and passed as a `coupon`
  // discount — not reconstructed as a second `price_data` line item — so
  // Stripe's own total math (session.amount_total /
  // total_details.amount_discount, what order-fulfillment.ts trusts as the
  // source of truth for money) is what actually reflects the discount.
  // `getCartSummary` already re-validated this code against the live
  // subtotal, so a lookup miss here would mean it vanished in the instant
  // between that read and this one — not a real case to branch on.
  let discounts: Array<{ coupon: string }> | undefined;
  if (summary.appliedDiscountCode) {
    const discountCode = await getDiscountCodeById(
      summary.appliedDiscountCode.id,
    );
    const couponId = await ensureStripeCoupon(discountCode!);
    discounts = [{ coupon: couponId }];
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ["US"] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: shippingBand.displayName,
            fixed_amount: {
              amount: shippingBand.amountCents,
              currency: "usd",
            },
          },
        },
      ],
      automatic_tax: { enabled: true },
      ...(discounts ? { discounts } : {}),
      metadata: { cart_id: cartId },
      success_url: `${env.NEXT_PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.NEXT_PUBLIC_SITE_URL}/checkout/cancelled`,
    },
    { idempotencyKey: options.idempotencyKey },
  );

  if (!session.url) {
    throw new Error(`Stripe Checkout Session ${session.id} has no url`);
  }

  return { ok: true, sessionId: session.id, url: session.url };
}
