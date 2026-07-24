import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

const cartCookie = vi.hoisted(() => ({
  cartId: undefined as string | undefined,
}));

vi.mock("@/lib/cart-cookie", () => ({
  readCartId: vi.fn(async () => cartCookie.cartId),
}));

import { db } from "@/lib/db/client";
import { cartItems, carts, productVariants, products } from "@/lib/db/schema";
import { createCart, upsertCartItem } from "@/lib/repos/cart";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { SiteHeader } from "./site-header";

// SiteHeader is an async Server Component (it reads the cart_id cookie and
// re-prices the cart for the header count) — invoked and awaited directly
// before being handed to render(), same pattern used for the storefront's
// page-level Server Components (e.g. products/page.test.tsx).

describe("SiteHeader", () => {
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

  it("renders the site name linking home", async () => {
    cartCookie.cartId = undefined;
    render(await SiteHeader());
    expect(
      screen.getByRole("link", { name: "Fasthorse Creations" }),
    ).toHaveAttribute("href", "/");
  });

  it("renders primary navigation as a landmark", async () => {
    cartCookie.cartId = undefined;
    render(await SiteHeader());
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute(
      "href",
      "/products",
    );
  });

  it("renders a cart indicator showing 0 items when no cart cookie exists", async () => {
    cartCookie.cartId = undefined;
    render(await SiteHeader());
    expect(
      screen.getByRole("link", { name: /cart, 0 items/i }),
    ).toHaveAttribute("href", "/cart");
  });

  it("reflects the real cart's total quantity across lines", async () => {
    const product = await createProduct({
      slug: "test-header-count",
      name: "Header Count Candle",
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "TEST-HEADER-COUNT",
      name: "Header Count Candle",
      priceCents: 1500,
      weightGrams: 100,
    });

    const cart = await createCart();
    insertedCartIds.push(cart.id);
    await upsertCartItem({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 3,
    });
    cartCookie.cartId = cart.id;

    render(await SiteHeader());

    expect(
      screen.getByRole("link", { name: /cart, 3 items/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    cartCookie.cartId = undefined;
    const { container } = render(await SiteHeader());
    expect(await axe(container)).toHaveNoViolations();
  });
});
