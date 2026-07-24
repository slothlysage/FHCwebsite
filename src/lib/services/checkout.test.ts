import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  discountCodes,
  productVariants,
  products,
} from "@/lib/db/schema";
import {
  createCart,
  setCartDiscountCode,
  upsertCartItem,
} from "@/lib/repos/cart";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import type { createCheckoutSession as CreateCheckoutSession } from "@/lib/services/checkout";
import {
  getStripeFakeCheckoutSessions,
  getStripeFakeCoupons,
  resetStripeFakeState,
  seedStripePrice,
  stripeServer,
} from "../../../tests/msw/stripe-server";

// Integration tests against the real dev database (cart/products/variants),
// with Stripe intercepted at the network boundary via msw — see
// tests/msw/stripe-server.ts. `createCheckoutSession` is imported
// dynamically, AFTER `stripeServer.listen()`, not via a static top-level
// import: the singleton `stripe` client it transitively imports captures
// `globalThis.fetch` at construction time, so a static import would
// construct it before msw has patched fetch and silently hit the real
// Stripe test-mode API. Same reasoning and same fix as
// stripe-catalog-sync.test.ts (specs/05-payments.md, "Implementation notes
// (3.2b)").
let createCheckoutSession: typeof CreateCheckoutSession;

beforeAll(async () => {
  stripeServer.listen({ onUnhandledRequest: "error" });
  vi.resetModules();
  ({ createCheckoutSession } = await import("@/lib/services/checkout"));
});
afterEach(() => {
  stripeServer.resetHandlers();
  resetStripeFakeState();
});
afterAll(() => stripeServer.close());

describe("createCheckoutSession", () => {
  const insertedProductIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedDiscountCodeIds: string[] = [];

  afterEach(async () => {
    for (const cartId of insertedCartIds.splice(0)) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
      await db.delete(carts).where(eq(carts.id, cartId));
    }
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    for (const id of insertedDiscountCodeIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
    }
  });

  async function makeSyncedCart(
    lines: Array<{
      priceCents: number;
      stripePriceId: string;
      quantity: number;
      weightGrams?: number;
    }>,
  ) {
    const cart = await createCart();
    insertedCartIds.push(cart.id);

    for (const [index, line] of lines.entries()) {
      const product = await createProduct({
        slug: `test-checkout-${cart.id}-${index}`,
        name: `Test Checkout Product ${index}`,
        status: "published",
      });
      insertedProductIds.push(product.id);
      const variant = await createVariant({
        productId: product.id,
        sku: `TEST-CHECKOUT-${cart.id}-${index}`,
        name: "Default",
        priceCents: line.priceCents,
        weightGrams: line.weightGrams ?? 100,
        stripePriceId: line.stripePriceId,
      });
      seedStripePrice({
        id: line.stripePriceId,
        object: "price",
        active: true,
        unit_amount: line.priceCents,
        currency: "usd",
        product: `prod_${line.stripePriceId}`,
        metadata: {},
      });
      await upsertCartItem({
        cartId: cart.id,
        variantId: variant.id,
        quantity: line.quantity,
      });
    }

    return cart;
  }

  it("returns empty_cart and calls Stripe zero times for a cart with no items", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);

    const result = await createCheckoutSession(cart.id, {
      idempotencyKey: "test-empty",
    });

    expect(result).toEqual({ ok: false, reason: "empty_cart" });
    expect(getStripeFakeCheckoutSessions()).toHaveLength(0);
  });

  it("returns unavailable when a cart line's variant has not been synced to Stripe", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const product = await createProduct({
      slug: `test-checkout-unsynced-${cart.id}`,
      name: "Unsynced Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-CHECKOUT-UNSYNCED-${cart.id}`,
      name: "Default",
      priceCents: 1000,
      weightGrams: 100,
    });
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });

    const result = await createCheckoutSession(cart.id, {
      idempotencyKey: "test-unsynced",
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(getStripeFakeCheckoutSessions()).toHaveLength(0);
  });

  it("builds line items from the database price and cart quantity, not from anything client-supplied", async () => {
    const cart = await makeSyncedCart([
      { priceCents: 1500, stripePriceId: "price_checkout_a", quantity: 2 },
      { priceCents: 750, stripePriceId: "price_checkout_b", quantity: 1 },
    ]);

    const result = await createCheckoutSession(cart.id, {
      idempotencyKey: "test-build",
    });

    expect(result.ok).toBe(true);
    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.mode).toBe("payment");
    expect(session?.metadata.cart_id).toBe(cart.id);
    expect(session?.lineItems).toEqual(
      expect.arrayContaining([
        { price: "price_checkout_a", quantity: 2, unitAmount: 1500 },
        { price: "price_checkout_b", quantity: 1, unitAmount: 750 },
      ]),
    );
  });

  it("collects a US shipping address and applies a single weight-tiered shipping rate", async () => {
    const cart = await makeSyncedCart([
      { priceCents: 1000, stripePriceId: "price_checkout_ship", quantity: 1 },
    ]);

    await createCheckoutSession(cart.id, { idempotencyKey: "test-shipping" });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.shippingAddressCollection).toEqual(["US"]);
    expect(session?.shippingOptions).toHaveLength(1);
    expect(session?.shippingOptions[0]?.amount).toBeGreaterThan(0);
  });

  it("charges the under-1lb tier for a cart whose total weight is below 454g", async () => {
    const cart = await makeSyncedCart([
      {
        priceCents: 1000,
        stripePriceId: "price_checkout_light",
        quantity: 1,
        weightGrams: 200,
      },
    ]);

    await createCheckoutSession(cart.id, { idempotencyKey: "test-tier-light" });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.shippingOptions).toHaveLength(1);
    expect(session?.shippingOptions[0]).toEqual({
      displayName: "Standard shipping (under 1 lb)",
      amount: 500,
    });
  });

  it("charges the 1-3lb tier once cart weight crosses the first band boundary", async () => {
    const cart = await makeSyncedCart([
      {
        priceCents: 1000,
        stripePriceId: "price_checkout_mid",
        quantity: 3,
        weightGrams: 200,
      },
    ]);
    // 3 x 200g = 600g, just past the 454g under-1lb ceiling.

    await createCheckoutSession(cart.id, { idempotencyKey: "test-tier-mid" });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.shippingOptions[0]).toEqual({
      displayName: "Standard shipping (1-3 lb)",
      amount: 800,
    });
  });

  it("charges the 3+lb tier once combined cart weight (quantity x per-line weight, summed across lines) crosses the second band boundary", async () => {
    const cart = await makeSyncedCart([
      {
        priceCents: 1000,
        stripePriceId: "price_checkout_heavy_a",
        quantity: 2,
        weightGrams: 500,
      },
      {
        priceCents: 500,
        stripePriceId: "price_checkout_heavy_b",
        quantity: 1,
        weightGrams: 400,
      },
    ]);
    // (2 x 500g) + (1 x 400g) = 1400g, past the 1361g 1-3lb ceiling.

    await createCheckoutSession(cart.id, { idempotencyKey: "test-tier-heavy" });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.shippingOptions[0]).toEqual({
      displayName: "Standard shipping (3+ lb)",
      amount: 1200,
    });
  });

  it("enables Stripe Tax", async () => {
    const cart = await makeSyncedCart([
      { priceCents: 1000, stripePriceId: "price_checkout_tax", quantity: 1 },
    ]);

    await createCheckoutSession(cart.id, { idempotencyKey: "test-tax" });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.automaticTaxEnabled).toBe(true);
  });

  it("is idempotent: the same idempotency key returns the same session instead of creating a second one", async () => {
    const cart = await makeSyncedCart([
      { priceCents: 1000, stripePriceId: "price_checkout_idem", quantity: 1 },
    ]);

    const first = await createCheckoutSession(cart.id, {
      idempotencyKey: "test-idempotent-key",
    });
    const second = await createCheckoutSession(cart.id, {
      idempotencyKey: "test-idempotent-key",
    });

    expect(first.ok && second.ok && first.sessionId).toBe(
      first.ok && second.ok && second.sessionId,
    );
    expect(getStripeFakeCheckoutSessions()).toHaveLength(1);
  });

  it("passes no discounts param when the cart has no applied code", async () => {
    const cart = await makeSyncedCart([
      {
        priceCents: 1000,
        stripePriceId: "price_checkout_nodiscount",
        quantity: 1,
      },
    ]);

    await createCheckoutSession(cart.id, {
      idempotencyKey: "test-no-discount",
    });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.discountCoupon).toBeNull();
    expect(getStripeFakeCoupons()).toHaveLength(0);
  });

  it("syncs the cart's applied discount code to a Stripe Coupon and passes it to the session", async () => {
    const cart = await makeSyncedCart([
      {
        priceCents: 2000,
        stripePriceId: "price_checkout_discounted",
        quantity: 1,
      },
    ]);
    const [discountCode] = await db
      .insert(discountCodes)
      .values({ code: "TEST20", kind: "percent", value: 20 })
      .returning();
    insertedDiscountCodeIds.push(discountCode!.id);
    await setCartDiscountCode(cart.id, discountCode!.id);

    await createCheckoutSession(cart.id, {
      idempotencyKey: "test-with-discount",
    });

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.discountCoupon).not.toBeNull();
    const coupon = getStripeFakeCoupons().find(
      (c) => c.id === session?.discountCoupon,
    );
    expect(coupon?.percent_off).toBe(20);
  });

  it("propagates a genuine Stripe error instead of swallowing it", async () => {
    stripeServer.use(
      http.post("https://api.stripe.com/v1/checkout/sessions", () =>
        HttpResponse.json(
          {
            error: {
              type: "api_error",
              code: "lock_timeout",
              message: "try again",
            },
          },
          { status: 500 },
        ),
      ),
    );
    const cart = await makeSyncedCart([
      { priceCents: 1000, stripePriceId: "price_checkout_err", quantity: 1 },
    ]);

    await expect(
      createCheckoutSession(cart.id, { idempotencyKey: "test-error" }),
    ).rejects.toThrow(/try again/);
  });
});
