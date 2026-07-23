import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cartCookie = vi.hoisted(() => ({
  cartId: undefined as string | undefined,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/cart-cookie", () => ({
  readCartId: vi.fn(async () => cartCookie.cartId),
  writeCartId: vi.fn(async (id: string) => {
    cartCookie.cartId = id;
  }),
}));

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  inventoryMovements,
  productVariants,
  products,
} from "@/lib/db/schema";
import {
  createCart,
  getCartItem,
  listCartItemsByCartId,
} from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import {
  addToCartAction,
  removeCartItemAction,
  updateCartItemAction,
} from "./cart";

// Integration tests against the real dev database (specs/06-testing.md),
// same convention as every other repo/service test in this repo. The only
// things mocked are the two Next runtime APIs that require an active
// request/action context to work at all (next/headers' cookies() via
// @/lib/cart-cookie, and next/cache's revalidatePath) — everything else
// (cart creation, cart mutation, availability/clamping) runs for real.

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("cart actions", () => {
  const insertedProductIds: string[] = [];
  const insertedVariantIds: string[] = [];

  beforeEach(() => {
    cartCookie.cartId = undefined;
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    if (cartCookie.cartId) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartCookie.cartId));
      await db.delete(carts).where(eq(carts.id, cartCookie.cartId));
    }
    const variantIds = insertedVariantIds.splice(0);
    if (variantIds.length > 0) {
      await db
        .delete(inventoryMovements)
        .where(inArray(inventoryMovements.variantId, variantIds));
    }
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makeVariant(slug: string, sku: string, stock = 5) {
    const product = await createProduct({
      slug,
      name: slug,
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku,
      name: slug,
      priceCents: 500,
      weightGrams: 100,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({
      variantId: variant.id,
      delta: stock,
      reason: "adjustment",
    });
    return variant;
  }

  it("addToCartAction creates a cart cookie on first add and persists the line", async () => {
    const variant = await makeVariant("test-cart-action-add", "TEST-CA-ADD");

    await addToCartAction(formData({ variantId: variant.id, quantity: "2" }));

    expect(cartCookie.cartId).toBeDefined();
    const items = await listCartItemsByCartId(cartCookie.cartId!);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ variantId: variant.id, quantity: 2 });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("addToCartAction reuses the existing cart cookie and increments the line", async () => {
    const variant = await makeVariant(
      "test-cart-action-reuse",
      "TEST-CA-REUSE",
    );
    const cart = await createCart();
    cartCookie.cartId = cart.id;

    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));

    expect(cartCookie.cartId).toBe(cart.id);
    const item = await getCartItem(cart.id, variant.id);
    expect(item?.quantity).toBe(2);
  });

  it("addToCartAction defaults to quantity 1 when the field is missing", async () => {
    const variant = await makeVariant(
      "test-cart-action-default-qty",
      "TEST-CA-DEFQTY",
    );

    await addToCartAction(formData({ variantId: variant.id }));

    const item = await getCartItem(cartCookie.cartId!, variant.id);
    expect(item?.quantity).toBe(1);
  });

  it("addToCartAction is a no-op for a malformed variantId", async () => {
    await addToCartAction(formData({ variantId: "not-a-uuid", quantity: "1" }));

    expect(cartCookie.cartId).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updateCartItemAction sets an absolute quantity", async () => {
    const variant = await makeVariant(
      "test-cart-action-update",
      "TEST-CA-UPDATE",
    );
    const cart = await createCart();
    cartCookie.cartId = cart.id;
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));

    await updateCartItemAction(
      formData({ variantId: variant.id, quantity: "4" }),
    );

    const item = await getCartItem(cart.id, variant.id);
    expect(item?.quantity).toBe(4);
  });

  it("updateCartItemAction with quantity 0 removes the line", async () => {
    const variant = await makeVariant("test-cart-action-zero", "TEST-CA-ZERO");
    const cart = await createCart();
    cartCookie.cartId = cart.id;
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));

    await updateCartItemAction(
      formData({ variantId: variant.id, quantity: "0" }),
    );

    expect(await getCartItem(cart.id, variant.id)).toBeUndefined();
  });

  it("removeCartItemAction removes the line entirely", async () => {
    const variant = await makeVariant(
      "test-cart-action-remove",
      "TEST-CA-REMOVE",
    );
    const cart = await createCart();
    cartCookie.cartId = cart.id;
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));

    await removeCartItemAction(formData({ variantId: variant.id }));

    expect(await getCartItem(cart.id, variant.id)).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("updateCartItemAction is a no-op for a malformed variantId", async () => {
    const cart = await createCart();
    cartCookie.cartId = cart.id;

    await updateCartItemAction(
      formData({ variantId: "not-a-uuid", quantity: "1" }),
    );

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removeCartItemAction is a no-op for a malformed variantId", async () => {
    const cart = await createCart();
    cartCookie.cartId = cart.id;

    await removeCartItemAction(formData({ variantId: "not-a-uuid" }));

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
