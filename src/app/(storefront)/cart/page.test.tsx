import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const cartCookie = vi.hoisted(() => ({
  cartId: undefined as string | undefined,
}));

vi.mock("@/lib/cart-cookie", () => ({
  readCartId: vi.fn(async () => cartCookie.cartId),
}));

import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  inventoryMovements,
  productVariants,
  products,
} from "@/lib/db/schema";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { createProduct } from "@/lib/repos/products";
import { createVariant, deactivateVariant } from "@/lib/repos/variants";
import CartPage from "./page";

// Integration test against the real dev database (specs/06-testing.md) — an
// async Server Component, invoked and awaited directly, same pattern as
// products/page.test.tsx. Only next/headers' cookies() (via the cart-cookie
// mock above) is faked, since it requires an active Next request to work at
// all outside a real server.

describe("CartPage", () => {
  const insertedProductIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedVariantIds: string[] = [];

  afterEach(async () => {
    cartCookie.cartId = undefined;
    for (const cartId of insertedCartIds.splice(0)) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
      await db.delete(carts).where(eq(carts.id, cartId));
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

  it("shows an empty-cart message with a link to keep shopping when there is no cart cookie", async () => {
    render(await CartPage());

    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /continue shopping/i }),
    ).toHaveAttribute("href", "/products");
  });

  it("renders server-recomputed line items and the subtotal", async () => {
    const product = await createProduct({
      slug: "test-cart-page-line",
      name: "Cart Page Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-CART-PAGE",
      name: "8oz",
      priceCents: 1200,
      weightGrams: 200,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({
      variantId: variant.id,
      delta: 10,
      reason: "adjustment",
    });

    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 3,
    });
    cartCookie.cartId = cart.id;

    render(await CartPage());

    expect(
      screen.getByRole("link", { name: "Cart Page Candle" }),
    ).toHaveAttribute("href", "/products/test-cart-page-line");
    expect(screen.getByText("$12.00 each")).toBeInTheDocument();
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(3);
    expect(
      within(screen.getByText("Subtotal").closest("div")!).getByText("$36.00"),
    ).toBeInTheDocument(); // subtotal: 3 x $12
    expect(
      screen.getByRole("button", {
        name: /remove cart page candle from cart/i,
      }),
    ).toBeInTheDocument();
  });

  it("reports an adjustment when a line was clamped or removed on read", async () => {
    const product = await createProduct({
      slug: "test-cart-page-adjustment",
      name: "Deactivated Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-CART-PAGE-ADJ",
      name: "8oz",
      priceCents: 1000,
      weightGrams: 200,
    });
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 1,
    });
    await deactivateVariant(variant.id);
    cartCookie.cartId = cart.id;

    render(await CartPage());

    expect(
      screen.getByText(/deactivated candle is no longer available/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it("reports a quantity-reduced adjustment when stock drops below the cart's quantity", async () => {
    const product = await createProduct({
      slug: "test-cart-page-clamped",
      name: "Clamped Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-CART-PAGE-CLAMP",
      name: "8oz",
      priceCents: 1000,
      weightGrams: 200,
      allowBackorder: false,
    });
    insertedVariantIds.push(variant.id);
    await recordMovement({
      variantId: variant.id,
      delta: 1,
      reason: "adjustment",
    });

    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 5,
    });
    cartCookie.cartId = cart.id;

    render(await CartPage());

    expect(
      screen.getByText(/clamped candle quantity was reduced to 1/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(1);
  });

  it("shows a made-to-order label for a zero-stock, backorderable line", async () => {
    const product = await createProduct({
      slug: "test-cart-page-backorder",
      name: "Backorder Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-CART-PAGE-BACKORDER",
      name: "8oz",
      priceCents: 1000,
      weightGrams: 200,
      allowBackorder: true,
    });
    insertedVariantIds.push(variant.id);

    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 2,
    });
    cartCookie.cartId = cart.id;

    render(await CartPage());

    expect(screen.getByText(/made to order/i)).toBeInTheDocument();
  });
});
