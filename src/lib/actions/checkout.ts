"use server";

import { redirect } from "next/navigation";

import { readCartId } from "@/lib/cart-cookie";
import { createCheckoutSession } from "@/lib/services/checkout";

// The only thing this reads from `formData` is `nonce` — a value the cart
// page (src/app/(storefront)/cart/page.tsx), not the client, embeds fresh
// on every render, so a double-submit of the same rendered form collapses
// to the same Stripe idempotency key instead of creating two sessions. Any
// other field a POST to this action includes (price, quantity, total, ...)
// is never read: every amount in the resulting Checkout Session comes from
// `createCheckoutSession`'s own database/Stripe lookups keyed on the
// cart_id cookie, never from `formData` (AGENT.md: "Prices are computed
// server-side ... Client-supplied prices are ignored, not validated").
export async function createCheckoutSessionAction(
  formData: FormData,
): Promise<void> {
  const nonce = formData.get("nonce");
  const cartId = await readCartId();

  if (!cartId || typeof nonce !== "string" || nonce.length === 0) {
    redirect("/cart");
  }

  const result = await createCheckoutSession(cartId, {
    idempotencyKey: `checkout-session-${cartId}-${nonce}`,
  });

  if (!result.ok) {
    redirect(`/cart?checkout_error=${result.reason}`);
  }

  redirect(result.url);
}
