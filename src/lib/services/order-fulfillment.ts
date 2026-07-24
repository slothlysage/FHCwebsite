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
import { incrementDiscountCodeUsage } from "@/lib/repos/discount-codes";
import {
  getStockForVariant,
  lockVariantStock,
  recordMovement,
} from "@/lib/repos/inventory";
import { createOrder, getOrderItemsByOrderId } from "@/lib/repos/orders";
import { withTransaction } from "@/lib/repos/transaction";
import { sendEmail } from "@/lib/email/send";
import { getCartSummary } from "@/lib/services/cart";
import { buildOrderReceiptEmail } from "@/lib/services/receipt";

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
  const order = await withTransaction(async (tx) => {
    // Oversell guard (specs/05-payments.md's "Oversell" section, task 3.6):
    // getCartSummary already re-checked stock once, at session-creation
    // read time — but that doesn't stop two different carts from each
    // separately clamping to "1 left" for the same last unit. Locking every
    // distinct variant in this cart (in a fixed, ascending order — so two
    // concurrent fulfillments touching the same two variants can never
    // deadlock waiting on each other) before re-reading stock makes the
    // second fulfillment to reach a given variant see the first's
    // already-committed decrement, not a stale pre-race number.
    const sortedVariantIds = [
      ...new Set(summary.lines.map((line) => line.variantId)),
    ].sort();
    for (const variantId of sortedVariantIds) {
      await lockVariantStock(variantId, tx);
    }

    // A variant with allowBackorder is made-to-order (1.7) — an oversell
    // there is expected and legal, not a guard-worthy event. Only a
    // non-backorder variant selling out between session creation and
    // payment landing is "unexpected" and flags the whole order.
    let hasUnexpectedOversell = false;
    const lineOverselds = new Map<string, number>();
    for (const line of summary.lines) {
      const availableStock = await getStockForVariant(line.variantId);
      const oversoldQuantity = Math.max(0, line.quantity - availableStock);
      lineOverselds.set(line.variantId, oversoldQuantity);
      if (oversoldQuantity > 0 && !line.allowBackorder) {
        hasUnexpectedOversell = true;
      }
    }

    const order = await createOrder(
      {
        email: session.customer_details?.email ?? session.customer_email ?? "",
        // Still created and still paid for (Stripe already captured the
        // charge) — "needs_attention" flags a fulfillment problem, it is
        // never a silent refund (spec: "a hand-made business often can make
        // one more").
        status: hasUnexpectedOversell ? "needs_attention" : "paid",
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
        discountCodeId: summary.appliedDiscountCode?.id ?? null,
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
        oversoldQuantity: lineOverselds.get(line.variantId) ?? 0,
      })),
      tx,
    );

    // Atomic increment, inside the same tx as the order that redeemed it —
    // this, not the cart-time read-then-check in discount.ts, is what makes
    // "a code cannot be applied twice" hold under concurrent checkouts
    // (specs/05-payments.md's "Implementation notes (3.8a)"). Runs at most
    // once per event because the webhook's own event-id idempotency guard
    // (src/lib/stripe/webhook.ts) already ensures this whole function runs
    // at most once per Stripe event.
    if (summary.appliedDiscountCode) {
      await incrementDiscountCodeUsage(summary.appliedDiscountCode.id, tx);
    }

    if (hasUnexpectedOversell) {
      // No owner-notification channel exists yet (fix_plan.md's "Blocked —
      // needs human" — same gap 3.4 logged for disputes) — this is the
      // loudest signal available today.
      console.error(
        `[order-fulfillment] order ${order.id} (session ${session.id}) needs_attention: sold out of a non-backorder variant between checkout and payment`,
      );
    }

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

    return order;
  });

  // Email is sent after commit — a send failure must never roll back a paid
  // order (specs/05-payments.md's "Transactions" section). `sendEmail`
  // itself never throws (src/lib/email/send.ts), but this still guards
  // against a bug in receipt-building so that path can never take down an
  // already-committed order either.
  if (!order.email) {
    console.error(
      `[order-fulfillment] order ${order.id} (session ${session.id}): no email on file, skipping receipt`,
    );
    return;
  }
  try {
    const items = await getOrderItemsByOrderId(order.id);
    const receipt = buildOrderReceiptEmail(order, items);
    await sendEmail({ to: order.email, ...receipt });
  } catch (error) {
    console.error(
      `[order-fulfillment] order ${order.id} (session ${session.id}): receipt email failed: ${String(error)}`,
    );
  }
}
