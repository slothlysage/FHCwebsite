import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { cartItems, carts, productVariants, products } from "@/lib/db/schema";
import {
  createCart,
  deleteCartItemsByCartId,
  getCartById,
  listCartItemsByCartId,
  removeCartItem,
  upsertCartItem,
} from "@/lib/repos/cart";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("cart repo", () => {
  const insertedProductIds: string[] = [];
  const insertedCartIds: string[] = [];

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

  async function makeProductAndVariant(slug: string, sku: string) {
    const product = await createProduct({ slug, name: slug });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku,
      name: slug,
      priceCents: 1000,
      weightGrams: 100,
    });
    return { product, variant };
  }

  it("creates a cart", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);

    expect(cart.id).toBeTruthy();
    expect(cart.createdAt).toBeInstanceOf(Date);
  });

  it("returns undefined for a nonexistent cart id", async () => {
    const found = await getCartById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("gets a cart by id", async () => {
    const created = await createCart();
    insertedCartIds.push(created.id);

    const found = await getCartById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it("upserts a new cart item", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const { variant } = await makeProductAndVariant(
      "test-cart-upsert-new",
      "TEST-CART-UPSERT-NEW",
    );

    const item = await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 2,
    });

    expect(item.cartId).toBe(cart.id);
    expect(item.variantId).toBe(variant.id);
    expect(item.quantity).toBe(2);
  });

  it("upserting the same cart+variant again sets the quantity in place, not a second row", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const { variant } = await makeProductAndVariant(
      "test-cart-upsert-existing",
      "TEST-CART-UPSERT-EXISTING",
    );

    const first = await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });
    const second = await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 5,
    });

    expect(second.id).toBe(first.id);
    expect(second.quantity).toBe(5);

    const items = await listCartItemsByCartId(cart.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(5);
  });

  it("lists every item in a cart", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const { variant: variantA } = await makeProductAndVariant(
      "test-cart-list-a",
      "TEST-CART-LIST-A",
    );
    const { variant: variantB } = await makeProductAndVariant(
      "test-cart-list-b",
      "TEST-CART-LIST-B",
    );
    await upsertCartItem({
      cartId: cart.id,
      variantId: variantA.id,
      quantity: 1,
    });
    await upsertCartItem({
      cartId: cart.id,
      variantId: variantB.id,
      quantity: 3,
    });

    const items = await listCartItemsByCartId(cart.id);
    const variantIds = items.map((i) => i.variantId);

    expect(variantIds).toContain(variantA.id);
    expect(variantIds).toContain(variantB.id);
  });

  it("returns an empty array for a cart with no items", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);

    const items = await listCartItemsByCartId(cart.id);
    expect(items).toEqual([]);
  });

  it("removes a cart item, emptying the cart cleanly when it was the last one", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const { variant } = await makeProductAndVariant(
      "test-cart-remove",
      "TEST-CART-REMOVE",
    );
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });

    await removeCartItem(cart.id, variant.id);

    const items = await listCartItemsByCartId(cart.id);
    expect(items).toEqual([]);
    // The cart row itself still exists — removing its last item empties it,
    // it doesn't delete it.
    const stillFound = await getCartById(cart.id);
    expect(stillFound?.id).toBe(cart.id);
  });

  it("deletes every item in a cart, leaving the cart row itself intact", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    const { variant: variantA } = await makeProductAndVariant(
      "test-cart-clear-a",
      "TEST-CART-CLEAR-A",
    );
    const { variant: variantB } = await makeProductAndVariant(
      "test-cart-clear-b",
      "TEST-CART-CLEAR-B",
    );
    await upsertCartItem({
      cartId: cart.id,
      variantId: variantA.id,
      quantity: 1,
    });
    await upsertCartItem({
      cartId: cart.id,
      variantId: variantB.id,
      quantity: 2,
    });

    await deleteCartItemsByCartId(cart.id);

    const items = await listCartItemsByCartId(cart.id);
    expect(items).toEqual([]);
    const stillFound = await getCartById(cart.id);
    expect(stillFound?.id).toBe(cart.id);
  });

  it("clearing an already-empty cart is a harmless no-op", async () => {
    const cart = await createCart();
    insertedCartIds.push(cart.id);

    await expect(deleteCartItemsByCartId(cart.id)).resolves.not.toThrow();
  });
});
