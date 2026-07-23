import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { env } from "@/lib/env";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { getOrderByStripeSessionId } from "@/lib/repos/orders";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { stripe } from "@/lib/stripe/client";

import { POST } from "./route";

// Integration tests against the real dev database, exercising the exported
// route handler directly (the "invoke a Next.js handler and await it"
// pattern products/page.test.tsx established for Server Components applies
// equally to Route Handlers: construct a real Request, call the exported
// function). No msw needed — nothing here calls out to Stripe.

function signedRequest(body: object): Request {
  const payload = JSON.stringify(body);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
}

describe("POST /api/webhooks/stripe", () => {
  const insertedProductIds: string[] = [];
  const insertedVariantIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedEventIds: string[] = [];
  const insertedOrderStripeSessionIds: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("processes a validly signed checkout.session.completed and returns 200", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const product = await createProduct({
      slug: `test-route-${cart.id}`,
      name: "Test Route Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-ROUTE-${cart.id}`,
      name: "Default",
      priceCents: 1000,
      weightGrams: 100,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({ variantId: variant.id, delta: 3, reason: "import" });
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });

    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);
    const eventId = `evt_test_${randomUUID()}`;
    insertedEventIds.push(eventId);

    const response = await POST(
      signedRequest({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            object: "checkout.session",
            metadata: { cart_id: cart.id },
            amount_subtotal: 1000,
            amount_total: 1500,
            currency: "usd",
            customer_details: { email: "buyer@example.com" },
            payment_intent: `pi_test_${randomUUID()}`,
            shipping_cost: { amount_total: 500 },
            total_details: { amount_tax: 0, amount_discount: 0 },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    const order = await getOrderByStripeSessionId(sessionId);
    expect(order?.status).toBe("paid");
  });

  it("returns 400 and writes nothing for an invalid signature", async () => {
    const eventId = `evt_test_${randomUUID()}`;
    const request = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify({
        id: eventId,
        type: "checkout.session.completed",
        data: { object: {} },
      }),
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const [row] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, eventId));
    expect(row).toBeUndefined();
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const request = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify({ id: "evt_no_sig", type: "customer.created" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 200 for an unhandled event type and logs it", async () => {
    const eventId = `evt_test_${randomUUID()}`;
    insertedEventIds.push(eventId);

    const response = await POST(
      signedRequest({
        id: eventId,
        type: "customer.created",
        data: { object: { id: "cus_test" } },
      }),
    );

    expect(response.status).toBe(200);
  });
});
