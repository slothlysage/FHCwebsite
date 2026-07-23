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
import type Stripe from "stripe";

import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  inventoryMovements,
  orderItems,
  orders,
  productVariants,
  products,
} from "@/lib/db/schema";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { getStockForVariant, recordMovement } from "@/lib/repos/inventory";
import { getOrderByStripeSessionId } from "@/lib/repos/orders";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { fulfillCheckoutSession } from "@/lib/services/order-fulfillment";

// Integration tests against the real dev database (specs/06-testing.md). No
// Stripe network call is involved — `fulfillCheckoutSession` only reads the
// plain `Stripe.Checkout.Session` object it's handed, so a hand-built fake
// (cast, not fetched) is enough; no msw server needed here.

describe("fulfillCheckoutSession", () => {
  const insertedProductIds: string[] = [];
  const insertedVariantIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedOrderStripeSessionIds: string[] = [];
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    errorSpy.mockRestore();
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

  async function makeCartWithStock(initialStock: number) {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const product = await createProduct({
      slug: `test-fulfill-${cart.id}`,
      name: "Test Fulfillment Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-FULFILL-${cart.id}`,
      name: "Default",
      priceCents: 1200,
      weightGrams: 100,
    });
    insertedVariantIds.push(variant.id);
    if (initialStock !== 0) {
      await recordMovement({
        variantId: variant.id,
        delta: initialStock,
        reason: "import",
      });
    }
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 2,
    });
    return { cart, product, variant };
  }

  function fakeSession(
    overrides: Partial<Stripe.Checkout.Session> & { id: string },
  ): Stripe.Checkout.Session {
    return {
      object: "checkout.session",
      metadata: {},
      amount_subtotal: 2400,
      amount_total: 2900,
      currency: "usd",
      customer_details: {
        email: "buyer@example.com",
      } as Stripe.Checkout.Session.CustomerDetails,
      customer_email: null,
      payment_intent: `pi_test_${randomUUID()}`,
      shipping_cost: {
        amount_total: 500,
      } as Stripe.Checkout.Session.ShippingCost,
      total_details: {
        amount_tax: 0,
        amount_discount: 0,
      } as Stripe.Checkout.Session.TotalDetails,
      ...overrides,
    } as Stripe.Checkout.Session;
  }

  it("creates an order from the cart, decrements inventory, and empties the cart", async () => {
    const { cart, variant } = await makeCartWithStock(10);
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);

    await fulfillCheckoutSession(
      fakeSession({ id: sessionId, metadata: { cart_id: cart.id } }),
    );

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order?.status).toBe("paid");
    expect(order?.email).toBe("buyer@example.com");
    expect(order?.subtotalCents).toBe(2400);
    expect(order?.totalCents).toBe(2900);
    expect(order?.shippingCents).toBe(500);

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order!.id));
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(2);
    expect(items[0]?.skuSnapshot).toBe(`TEST-FULFILL-${cart.id}`);

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(8); // 10 on hand - 2 sold

    const remainingCartItems = await db
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id));
    expect(remainingCartItems).toEqual([]);
  });

  it("does nothing when the session has no cart_id metadata", async () => {
    const sessionId = `cs_test_${randomUUID()}`;

    await fulfillCheckoutSession(fakeSession({ id: sessionId, metadata: {} }));

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does nothing when the cart has no lines", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const sessionId = `cs_test_${randomUUID()}`;

    await fulfillCheckoutSession(
      fakeSession({ id: sessionId, metadata: { cart_id: cart.id } }),
    );

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("re-checks stock at webhook time and does not flag an oversold made-to-order (backorder-allowed) variant", async () => {
    const product = await createProduct({
      slug: `test-oversell-backorder-${randomUUID()}`,
      name: "Test Oversell Backorder Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-OVERSELL-BACKORDER-${randomUUID()}`,
      name: "Default",
      priceCents: 1200,
      weightGrams: 100,
      allowBackorder: true,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({ variantId: variant.id, delta: 1, reason: "import" });

    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 3,
    });
    const sessionId = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionId);

    await fulfillCheckoutSession(
      fakeSession({ id: sessionId, metadata: { cart_id: cart.id } }),
    );

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order?.status).toBe("paid");

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order!.id));
    expect(items[0]?.oversoldQuantity).toBe(2); // 3 requested - 1 on hand

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(-2); // legal for a backorder variant, per 1.7
  });

  it("re-checks stock at webhook time: concurrent fulfillment of the last unit of a non-backorder variant flags one order needs_attention and pays the other in full", async () => {
    const product = await createProduct({
      slug: `test-oversell-concurrent-${randomUUID()}`,
      name: "Test Oversell Concurrent Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-OVERSELL-CONCURRENT-${randomUUID()}`,
      name: "Default",
      priceCents: 1200,
      weightGrams: 100,
      allowBackorder: false,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({ variantId: variant.id, delta: 1, reason: "import" });

    const cartA = await createCart();
    insertedCartIds.push(cartA.id);
    await upsertCartItem({
      cartId: cartA.id,
      variantId: variant.id,
      quantity: 1,
    });
    const cartB = await createCart();
    insertedCartIds.push(cartB.id);
    await upsertCartItem({
      cartId: cartB.id,
      variantId: variant.id,
      quantity: 1,
    });

    const sessionIdA = `cs_test_${randomUUID()}`;
    const sessionIdB = `cs_test_${randomUUID()}`;
    insertedOrderStripeSessionIds.push(sessionIdA, sessionIdB);

    await Promise.all([
      fulfillCheckoutSession(
        fakeSession({ id: sessionIdA, metadata: { cart_id: cartA.id } }),
      ),
      fulfillCheckoutSession(
        fakeSession({ id: sessionIdB, metadata: { cart_id: cartB.id } }),
      ),
    ]);

    const orderA = await getOrderByStripeSessionId(sessionIdA);
    const orderB = await getOrderByStripeSessionId(sessionIdB);
    expect([orderA?.status, orderB?.status].sort()).toEqual([
      "needs_attention",
      "paid",
    ]);

    const itemsA = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderA!.id));
    const itemsB = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderB!.id));
    const oversoldTotal =
      (itemsA[0]?.oversoldQuantity ?? 0) + (itemsB[0]?.oversoldQuantity ?? 0);
    expect(oversoldTotal).toBe(1); // exactly one of the two units was unavailable

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(-1); // 1 on hand - 2 sold

    expect(errorSpy).toHaveBeenCalled();
  });

  it("rolls back the order, order items, and cart clear when the inventory movement write fails", async () => {
    const { cart, variant } = await makeCartWithStock(10);
    const sessionId = `cs_test_${randomUUID()}`;

    const inventoryRepo = await import("@/lib/repos/inventory");
    const recordMovementSpy = vi
      .spyOn(inventoryRepo, "recordMovement")
      .mockRejectedValueOnce(new Error("simulated failure"));

    await expect(
      fulfillCheckoutSession(
        fakeSession({ id: sessionId, metadata: { cart_id: cart.id } }),
      ),
    ).rejects.toThrow("simulated failure");

    recordMovementSpy.mockRestore();

    const order = await getOrderByStripeSessionId(sessionId);
    expect(order).toBeUndefined();

    const stock = await getStockForVariant(variant.id);
    expect(stock).toBe(10); // sale movement never committed

    const remainingCartItems = await db
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id));
    expect(remainingCartItems).toHaveLength(1); // cart-clear rolled back too
  });
});
