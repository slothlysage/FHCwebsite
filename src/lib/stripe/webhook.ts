// Stripe webhook signature verification + event dispatch
// (specs/05-payments.md's "Webhooks" section). The route handler
// (src/app/api/webhooks/stripe/route.ts) is a thin wrapper around this
// module: read the raw body, verify it here, dispatch it here.
import type Stripe from "stripe";

import { env } from "@/lib/env";
import {
  getOrderByStripePaymentIntentId,
  updateOrder,
} from "@/lib/repos/orders";
import {
  insertWebhookEvent,
  markWebhookEventProcessed,
} from "@/lib/repos/webhook-events";
import { fulfillCheckoutSession } from "@/lib/services/order-fulfillment";
import { stripe } from "@/lib/stripe/client";

// Pure local crypto (HMAC over the raw body), not a network call — safe to
// use the shared `stripe` singleton directly with no msw/dynamic-import
// gotcha (unlike 3.2b/3.3's Stripe-API-calling code).
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
}

function paymentIntentIdOf(
  value: string | Stripe.PaymentIntent | null | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
  const order = paymentIntentId
    ? await getOrderByStripePaymentIntentId(paymentIntentId)
    : undefined;
  if (!order) {
    console.error(
      `[stripe webhook] charge.refunded ${charge.id}: no order found for payment_intent ${paymentIntentId ?? "(none)"}`,
    );
    return;
  }
  // `charge.refunded` (the boolean field) is true only once the full charge
  // amount has been refunded; this event can also fire for a partial
  // refund, where it stays false. specs/05-payments.md: "optionally
  // restock" is a decision left to 4.8 (Refunds admin task), not done here.
  await updateOrder(order.id, {
    status: charge.refunded ? "refunded" : "partially_refunded",
  });
}

// No `disputed` order status or owner-notification channel exists yet
// (fix_plan.md's "Blocked — needs human" — a schema/notification decision,
// not something to guess at here). Logging who/what is the whole handler.
async function handleChargeDisputeCreated(
  dispute: Stripe.Dispute,
): Promise<void> {
  const paymentIntentId = paymentIntentIdOf(dispute.payment_intent);
  const order = paymentIntentId
    ? await getOrderByStripePaymentIntentId(paymentIntentId)
    : undefined;
  console.error(
    `[stripe webhook] charge.dispute.created ${dispute.id}: ${
      order ? `order ${order.id}` : "no matching order"
    } — owner notification not yet implemented`,
  );
}

export async function handleStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  // specs/05-payments.md's "Idempotency": insert the event id first. A
  // false return here means we've already processed this event (Stripe
  // retries and delivers out of order) — stop, do not re-dispatch.
  const inserted = await insertWebhookEvent({
    stripeEventId: event.id,
    type: event.type,
    payload: event,
  });
  if (!inserted) {
    return;
  }

  switch (event.type) {
    case "checkout.session.completed":
      await fulfillCheckoutSession(
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "payment_intent.payment_failed":
      // No order_draft_id exists at session-creation time (3.3's NOTE) —
      // there is no row in our database to mark unpaid. Logging is correct
      // and complete.
      console.error(
        `[stripe webhook] payment_intent.payment_failed: ${event.id}`,
      );
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object as Stripe.Charge);
      break;
    case "charge.dispute.created":
      await handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
      break;
    default:
      console.log(`[stripe webhook] unhandled event type: ${event.type}`);
      break;
  }

  await markWebhookEventProcessed(event.id);
}
