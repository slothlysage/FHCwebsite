// Turns a completed Stripe Checkout Session into a paid order: creates the
// order + order items, decrements inventory for each line, and empties the
// cart it paid for — all four writes in one database transaction
// (specs/05-payments.md's "Transactions" section), so a failure partway
// through (e.g. an inventory movement write) leaves no orphaned order or
// order-items rows behind. Combined with the webhook's event-id idempotency
// guard (src/lib/stripe/webhook.ts), which ensures this function runs at
// most once per Stripe event, replaying the same event twice still creates
// exactly one order and decrements inventory once.
import type Stripe from "stripe";

import { deleteCartItemsByCartId } from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { createOrder } from "@/lib/repos/orders";
import { withTransaction } from "@/lib/repos/transaction";
import { getCartSummary } from "@/lib/services/cart";

export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const cartId = session.metadata?.cart_id;
  if (!cartId) {
    console.error(
      `[order-fulfillment] checkout session ${session.id} has no cart_id metadata`,
    );
    return;
  }

  // Re-derives line items from the live cart, the same source
  // createCheckoutSession (3.3) built the Stripe line items from — not from
  // anything on the Stripe session itself, keeping the database the one
  // source of truth for catalog identity (AGENT.md).
  const summary = await getCartSummary(cartId);
  if (summary.lines.length === 0) {
    console.error(
      `[order-fulfillment] checkout session ${session.id}: cart ${cartId} has no lines to fulfill`,
    );
    return;
  }

  // Money totals come from the Stripe session, not recomputed here — Stripe
  // is the source of truth for payment amounts (AGENT.md), including tax
  // and shipping, which automatic_tax/shipping_options compute Stripe-side.
  await withTransaction(async (tx) => {
    const order = await createOrder(
      {
        email: session.customer_details?.email ?? session.customer_email ?? "",
        status: "paid",
        subtotalCents: session.amount_subtotal ?? 0,
        shippingCents: session.shipping_cost?.amount_total ?? 0,
        taxCents: session.total_details?.amount_tax ?? 0,
        discountCents: session.total_details?.amount_discount ?? 0,
        totalCents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        paidAt: new Date(),
      },
      summary.lines.map((line) => ({
        variantId: line.variantId,
        productNameSnapshot: line.productName,
        variantNameSnapshot: line.variantName,
        skuSnapshot: line.sku,
        unitPriceCents: line.priceCents,
        quantity: line.quantity,
        lineTotalCents: line.lineTotalCents,
      })),
      tx,
    );

    for (const line of summary.lines) {
      await recordMovement(
        {
          variantId: line.variantId,
          delta: -line.quantity,
          reason: "sale",
          referenceId: order.id,
        },
        tx,
      );
    }

    await deleteCartItemsByCartId(cartId, tx);
  });
}
