import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  inventoryMovements,
  orderItems,
  orders,
  productVariants,
  products,
  webhookEvents,
} from "@/lib/db/schema";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import {
  createOrder,
  getOrderById,
  getOrderByStripeSessionId,
} from "@/lib/repos/orders";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { stripe } from "@/lib/stripe/client";
import {
  handleStripeWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/stripe/webhook";
import { env } from "@/lib/env";

// Integration tests against the real dev database. No network mocking
// needed: `stripe.webhooks.constructEvent`/`generateTestHeaderString` are
// pure local crypto (specs/05-payments.md's Testing section explicitly
// calls this out), and `handleStripeWebhookEvent` never calls the Stripe API
// itself — it only reads the event object it's handed.

function signedEvent(body: object): { payload: string; signature: string } {
  const payload = JSON.stringify(body);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  return { payload, signature };
}

describe("verifyWebhookSignature", () => {
  it("returns the parsed event for a validly signed payload", () => {
    const eventId = `evt_test_${randomUUID()}`;
    const { payload, signature } = signedEvent({
      id: eventId,
      type: "customer.created",
      data: { object: {} },
    });

    const event = verifyWebhookSignature(payload, signature);

    expect(event.id).toBe(eventId);
    expect(event.type).toBe("customer.created");
  });

  it("throws for an invalid signature", () => {
    const payload = JSON.stringify({ id: "evt_bad", type: "customer.created" });

    expect(() => verifyWebhookSignature(payload, "t=1,v1=deadbeef")).toThrow();
  });
});

describe("handleStripeWebhookEvent", () => {
  const insertedProductIds: string[] = [];
  const insertedVariantIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedEventIds: string[] = [];
  const insertedOrderStripeSessionIds: string[] = [];
  let errorSpy: MockInstance;
  let logSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    for (const eventId of insertedEventIds.splice(0)) {
      await db
        .delete(webhookEvents)
        .where(eq(webhookEvents.stripeEventId, eventId));
    }
    for (const stripeSessionId of insertedOrderStripeSessionIds.splice(0)) {
      const order = await getOrderByStripeSessionId(stripeSessionId);
      if (order) {
        await db.delete(orderItems).where(eq(orderItems.orderId, order.id));
        await db.delete(orders).where(eq(orders.id, order.id));
      }
    }
    for (const cartId of insertedCartIds.splice(0)) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
      await db.delete(carts).where(eq(carts.id, cartId));
    }
    for (const variantId of insertedVariantIds.splice(0)) {
      await db
        .delete(inventoryMovements)
        .where(eq(inventoryMovements.variantId, variantId));
    }
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeCartWithVariant() {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const product = await createProduct({
      slug: `test-webhook-${cart.id}`,
      name: "Test Webhook Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-WEBHOOK-${cart.id}`,
      name: "Default",
      priceCents: 1000,
      weightGrams: 100,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({ variantId: variant.id, delta: 5, reason: "import" });
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });
    return { cart, variant };
  }

  function checkoutCompletedEvent(cartId: string, sessionId: string) {
    return {
      id: `evt_test_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          metadata: { cart_id: cartId },
          amount_subtotal: 1000,
          amount_total: 1500,
          currency: "usd",
          customer_details: { email: "buyer@example.com" },
          payment_intent: `pi_test_${randomUUID()}`,
          shipping_cost: { amount_total: 500 },
          total_details: { amount_tax: 0, amount_discount: 0 },
        },
      },
    };
  }

  it("creates an order the first time and is a no-op on replay of the same event id", async () => {
    const { cart, variant } = await makeCartWithVariant();
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);
    const rawEvent = checkoutCompletedEvent(cart.id, sessionId);
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await handleStripeWebhookEvent(event);
    // Replay: same event id, dispatched a second time.
    await handleStripeWebhookEvent(event);

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order?.status).toBe("paid");

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    // 1 import (test setup) + exactly 1 sale, not 2.
    expect(movements.filter((m) => m.reason === "sale")).toHaveLength(1);

    const [eventRow] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, rawEvent.id));
    expect(eventRow?.processedAt).toBeInstanceOf(Date);
  });

  it("logs and returns 200-equivalent for an unhandled event type", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "customer.created",
      data: { object: { id: "cus_test" } },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await expect(handleStripeWebhookEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("customer.created"),
    );
    const [eventRow] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, rawEvent.id));
    expect(eventRow?.processedAt).toBeInstanceOf(Date);
  });

  it("logs payment_intent.payment_failed without writing an order", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_test_failed" } },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await handleStripeWebhookEvent(event);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("payment_intent.payment_failed"),
    );
  });

  it("sets an order refunded on charge.refunded when fully refunded", async () => {
    const paymentIntentId = `pi_test_${randomUUID()}`;
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);
    const order = await createOrder(
      {
        email: "buyer@example.com",
        status: "paid",
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      },
      [],
    );

    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_refunded",
          payment_intent: paymentIntentId,
          refunded: true,
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await handleStripeWebhookEvent(event);

    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("refunded");
  });

  it("sets an order partially_refunded on charge.refunded when not fully refunded", async () => {
    const paymentIntentId = `pi_test_${randomUUID()}`;
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);
    const order = await createOrder(
      {
        email: "buyer@example.com",
        status: "paid",
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      },
      [],
    );

    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_partial",
          payment_intent: paymentIntentId,
          refunded: false,
          amount: 1000,
          amount_refunded: 400,
        },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await handleStripeWebhookEvent(event);

    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("partially_refunded");
  });

  it("logs charge.refunded with no matching order instead of throwing", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_orphan",
          payment_intent: `pi_test_${randomUUID()}`,
          refunded: true,
        },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await expect(handleStripeWebhookEvent(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs charge.dispute.created with the matching order id", async () => {
    const paymentIntentId = `pi_test_${randomUUID()}`;
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);
    const order = await createOrder(
      {
        email: "buyer@example.com",
        status: "paid",
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      },
      [],
    );

    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_test_1", payment_intent: paymentIntentId },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await handleStripeWebhookEvent(event);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(order.id));
  });

  it("logs charge.refunded with a null payment_intent instead of throwing", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_no_pi",
          payment_intent: null,
          refunded: true,
        },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await expect(handleStripeWebhookEvent(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("(none)"));
  });

  it("logs charge.dispute.created with a null payment_intent instead of throwing", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_test_no_pi", payment_intent: null },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await expect(handleStripeWebhookEvent(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no matching order"),
    );
  });

  it("logs charge.dispute.created with no matching order instead of throwing", async () => {
    const rawEvent = {
      id: `evt_test_${randomUUID()}`,
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_test_orphan",
          payment_intent: `pi_test_${randomUUID()}`,
        },
      },
    };
    insertedEventIds.push(rawEvent.id);
    const { payload, signature } = signedEvent(rawEvent);
    const event = verifyWebhookSignature(payload, signature);

    await expect(handleStripeWebhookEvent(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
