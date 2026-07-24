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

// Same TestRedirect pattern as checkout.test.ts: redirect()'s real type is
// `(url: string) => never` (it throws to unwind the action), so the mock
// must throw too — applyDiscountCodeAction's error-path redirect() calls
// have no explicit `return`, and a non-throwing mock would let execution
// fall through into the next statement.
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

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  discountCodes,
  inventoryMovements,
  productVariants,
  products,
} from "@/lib/db/schema";
import {
  createCart,
  getCartById,
  getCartItem,
  listCartItemsByCartId,
} from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import {
  addToCartAction,
  applyDiscountCodeAction,
  removeCartItemAction,
  removeDiscountCodeAction,
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
  const insertedDiscountCodeIds: string[] = [];

  beforeEach(() => {
    cartCookie.cartId = undefined;
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    if (cartCookie.cartId) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartCookie.cartId));
      await db.delete(carts).where(eq(carts.id, cartCookie.cartId));
    }
    for (const id of insertedDiscountCodeIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
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

  async function makeDiscountCode(
    overrides: Partial<typeof discountCodes.$inferInsert>,
  ) {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "ACTIONTEST", kind: "fixed", value: 100, ...overrides })
      .returning();
    insertedDiscountCodeIds.push(created!.id);
    return created!;
  }

  it("applyDiscountCodeAction applies a valid code to the cart", async () => {
    const variant = await makeVariant(
      "test-cart-action-discount-apply",
      "TEST-CA-DISCOUNT-APPLY",
    );
    const cart = await createCart();
    cartCookie.cartId = cart.id;
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));
    const code = await makeDiscountCode({ code: "ACTIONAPPLY" });

    await applyDiscountCodeAction(formData({ code: "ACTIONAPPLY" }));

    const stored = await getCartById(cart.id);
    expect(stored?.discountCodeId).toBe(code.id);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("applyDiscountCodeAction redirects with the rejection reason for an invalid code", async () => {
    const cart = await createCart();
    cartCookie.cartId = cart.id;

    await expect(
      applyDiscountCodeAction(formData({ code: "DOES-NOT-EXIST" })),
    ).rejects.toThrow("REDIRECT:/cart?discount_error=not_found");
  });

  it("applyDiscountCodeAction redirects for a missing/blank code without touching the cart", async () => {
    const cart = await createCart();
    cartCookie.cartId = cart.id;

    await expect(
      applyDiscountCodeAction(formData({ code: "  " })),
    ).rejects.toThrow("REDIRECT:/cart?discount_error=invalid_code");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removeDiscountCodeAction clears an applied code", async () => {
    const variant = await makeVariant(
      "test-cart-action-discount-remove",
      "TEST-CA-DISCOUNT-REMOVE",
    );
    const cart = await createCart();
    cartCookie.cartId = cart.id;
    await addToCartAction(formData({ variantId: variant.id, quantity: "1" }));
    await makeDiscountCode({ code: "ACTIONREMOVE" });
    await applyDiscountCodeAction(formData({ code: "ACTIONREMOVE" }));

    await removeDiscountCodeAction();

    const stored = await getCartById(cart.id);
    expect(stored?.discountCodeId).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
