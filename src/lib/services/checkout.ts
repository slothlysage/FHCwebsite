// Builds a Stripe Checkout Session from the server-side cart (specs/
// 05-payments.md's "Checkout session" section). Deliberately takes only a
// `cartId` (sourced from the httpOnly cart cookie, never the client) and an
// `idempotencyKey` (caller-derived — see src/lib/actions/checkout.ts) — there
// is no code path here that reads a price, quantity, or total from a client
// payload, which is what makes the "tampered client payload" AC true by
// construction rather than by validation.
import { getCartSummary } from "@/lib/services/cart";
import { stripe } from "@/lib/stripe/client";
import { env } from "@/lib/env";

// No shipping-rate admin/config exists yet (that lands with 4.x's Settings
// page per specs/04-admin.md) — this is a single flat US rate so 3.3 can
// ship a real, working checkout without inventing that admin surface early.
// Placeholder amount, logged under fix_plan.md's "Blocked — needs human" for
// the owner to confirm/replace once real carrier rates are known.
const FLAT_RATE_SHIPPING_CENTS = 600;

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
  for (const line of summary.lines) {
    if (!line.stripePriceId) {
      return { ok: false, reason: "unavailable" };
    }
    lineItems.push({ price: line.stripePriceId, quantity: line.quantity });
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
            display_name: "Standard shipping",
            fixed_amount: {
              amount: FLAT_RATE_SHIPPING_CENTS,
              currency: "usd",
            },
          },
        },
      ],
      automatic_tax: { enabled: true },
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
