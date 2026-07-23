import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const cartCookie = vi.hoisted(() => ({
  cartId: undefined as string | undefined,
}));

vi.mock("@/lib/cart-cookie", () => ({
  readCartId: vi.fn(async () => cartCookie.cartId),
}));

// Mirrors how Next actually behaves (`redirect()`'s real type is `(url:
// string) => never` — it throws internally to unwind the action). Throwing
// here too matters for correctness, not just realism: the action's guard
// clauses call `redirect()` without an explicit `return`, so a non-throwing
// mock would let execution fall through into the next statement (e.g.
// calling `createCheckoutSession` with an `undefined` cartId).
class TestRedirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new TestRedirect(url);
  }),
}));

import { db } from "@/lib/db/client";
import { cartItems, carts, productVariants, products } from "@/lib/db/schema";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import type { createCheckoutSessionAction as CreateCheckoutSessionAction } from "@/lib/actions/checkout";
import {
  getStripeFakeCheckoutSessions,
  resetStripeFakeState,
  seedStripePrice,
  stripeServer,
} from "../../../tests/msw/stripe-server";

// Integration tests against the real dev database, with Stripe intercepted
// via msw. `createCheckoutSessionAction` transitively imports the Stripe
// singleton client, which captures `globalThis.fetch` at construction time —
// same dynamic-import-after-`listen()` requirement as
// stripe-catalog-sync.test.ts and checkout.test.ts (specs/05-payments.md,
// "Implementation notes (3.2b)").
let createCheckoutSessionAction: typeof CreateCheckoutSessionAction;

beforeAll(async () => {
  stripeServer.listen({ onUnhandledRequest: "error" });
  vi.resetModules();
  ({ createCheckoutSessionAction } = await import("@/lib/actions/checkout"));
});
afterEach(() => {
  stripeServer.resetHandlers();
  resetStripeFakeState();
});
afterAll(() => stripeServer.close());

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("createCheckoutSessionAction", () => {
  const insertedProductIds: string[] = [];
  const insertedCartIds: string[] = [];

  beforeEach(() => {
    cartCookie.cartId = undefined;
  });

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
  });

  async function makeSyncedCart(priceCents: number, quantity: number) {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const product = await createProduct({
      slug: `test-checkout-action-${cart.id}`,
      name: "Test Checkout Action Product",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-CHECKOUT-ACTION-${cart.id}`,
      name: "Default",
      priceCents,
      weightGrams: 100,
      stripePriceId: `price_action_${cart.id}`,
    });
    seedStripePrice({
      id: `price_action_${cart.id}`,
      object: "price",
      active: true,
      unit_amount: priceCents,
      currency: "usd",
      product: `prod_action_${cart.id}`,
      metadata: {},
    });
    await upsertCartItem({ cartId: cart.id, variantId: variant.id, quantity });
    cartCookie.cartId = cart.id;
    return cart;
  }

  it("redirects to /cart without calling Stripe when there is no cart cookie", async () => {
    cartCookie.cartId = undefined;

    await expect(
      createCheckoutSessionAction(formData({ nonce: "abc" })),
    ).rejects.toThrow("REDIRECT:/cart");
    expect(getStripeFakeCheckoutSessions()).toHaveLength(0);
  });

  it("redirects to /cart without calling Stripe when the nonce is missing", async () => {
    await makeSyncedCart(1000, 1);

    await expect(createCheckoutSessionAction(formData({}))).rejects.toThrow(
      "REDIRECT:/cart",
    );
    expect(getStripeFakeCheckoutSessions()).toHaveLength(0);
  });

  it("redirects to the Stripe-hosted session url derived entirely from the server-side cart, ignoring a tampered price/quantity/total in the submitted payload", async () => {
    const cart = await makeSyncedCart(1500, 2);

    let redirectedTo: string | undefined;
    try {
      // An attacker POSTing directly to this action's endpoint (bypassing
      // the cart page's own markup, which never renders these fields) could
      // include arbitrary extra fields. None of them are read.
      await createCheckoutSessionAction(
        formData({
          nonce: "tamper-nonce",
          price: "1",
          total: "1",
          quantity: "999",
          variantId: "attacker-supplied",
        }),
      );
    } catch (error) {
      redirectedTo = (error as TestRedirect).url;
    }

    expect(redirectedTo).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const [session] = getStripeFakeCheckoutSessions();
    expect(session?.metadata.cart_id).toBe(cart.id);
    // Server-derived amount (price 1500 x quantity 2), not the attacker's
    // "price": "1" / "quantity": "999" / "total": "1".
    expect(session?.lineItems).toEqual([
      { price: `price_action_${cart.id}`, quantity: 2, unitAmount: 1500 },
    ]);
  });

  it("redirects to /cart with a checkout_error when the cart is empty", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    cartCookie.cartId = cart.id;

    await expect(
      createCheckoutSessionAction(formData({ nonce: "empty-nonce" })),
    ).rejects.toThrow("REDIRECT:/cart?checkout_error=empty_cart");
  });

  it("double-submitting the same rendered form (same nonce) reuses one Stripe session", async () => {
    const cart = await makeSyncedCart(1000, 1);
    const data = formData({ nonce: "same-nonce" });

    const urls: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        await createCheckoutSessionAction(data);
      } catch (error) {
        urls.push((error as TestRedirect).url);
      }
    }

    expect(urls[0]).toBe(urls[1]);
    expect(
      getStripeFakeCheckoutSessions().filter(
        (s) => s.metadata.cart_id === cart.id,
      ),
    ).toHaveLength(1);
  });
});
