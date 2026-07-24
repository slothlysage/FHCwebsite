import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import {
  cartItems,
  carts,
  discountCodes,
  inventoryMovements,
  productVariants,
  products,
} from "@/lib/db/schema";
import { createCart, listCartItemsByCartId } from "@/lib/repos/cart";
import { recordMovement } from "@/lib/repos/inventory";
import { createProduct, updateProduct } from "@/lib/repos/products";
import { createVariant, updateVariant } from "@/lib/repos/variants";
import {
  addToCart,
  applyDiscountCode,
  getCartSummary,
  removeDiscountCode,
  removeFromCart,
  updateCartItemQuantity,
} from "@/lib/services/cart";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("cart service", () => {
  const insertedProductIds: string[] = [];
  const insertedCartIds: string[] = [];
  const insertedVariantIds: string[] = [];
  const insertedDiscountCodeIds: string[] = [];

  afterEach(async () => {
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
    for (const id of insertedDiscountCodeIds.splice(0)) {
      await db.delete(discountCodes).where(eq(discountCodes.id, id));
    }
  });

  async function insertDiscountCode(
    overrides: Partial<typeof discountCodes.$inferInsert>,
  ) {
    const [created] = await db
      .insert(discountCodes)
      .values({ code: "CARTSVC10", kind: "percent", value: 10, ...overrides })
      .returning();
    insertedDiscountCodeIds.push(created!.id);
    return created!;
  }

  async function makeCart() {
    const cart = await createCart();
    insertedCartIds.push(cart.id);
    return cart;
  }

  async function makeVariant(
    slug: string,
    sku: string,
    options?: {
      priceCents?: number;
      allowBackorder?: boolean;
      stock?: number;
      status?: "draft" | "published" | "archived";
      isActive?: boolean;
    },
  ) {
    const product = await createProduct({
      slug,
      name: slug,
      status: options?.status ?? "published",
    });
    insertedProductIds.push(product.id);
    let variant = await createVariant({
      productId: product.id,
      sku,
      name: slug,
      priceCents: options?.priceCents ?? 1000,
      weightGrams: 100,
      allowBackorder: options?.allowBackorder ?? false,
    });
    insertedVariantIds.push(variant.id);
    if (options?.isActive === false) {
      variant = (await updateVariant(variant.id, { isActive: false }))!;
    }
    if (options?.stock) {
      await recordMovement({
        variantId: variant.id,
        delta: options.stock,
        reason: "import",
      });
    }
    return { product, variant };
  }

  describe("getCartSummary", () => {
    it("returns an empty summary for a cart with no items", async () => {
      const cart = await makeCart();

      const summary = await getCartSummary(cart.id);

      expect(summary).toEqual({
        cartId: cart.id,
        lines: [],
        subtotalCents: 0,
        discountCents: 0,
        totalCents: 0,
        appliedDiscountCode: null,
        adjustments: [],
      });
    });

    it("re-prices a line from the current variant price, not the price at add-time", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-reprice",
        "TEST-CART-SVC-REPRICE",
        {
          priceCents: 1000,
          stock: 5,
        },
      );
      await addToCart(cart.id, variant.id, 2);

      await updateVariant(variant.id, { priceCents: 1500 });

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toHaveLength(1);
      expect(summary.lines[0]?.priceCents).toBe(1500);
      expect(summary.lines[0]?.lineTotalCents).toBe(3000);
      expect(summary.subtotalCents).toBe(3000);
    });

    it("clamps quantity down to available stock and persists the clamp", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-clamp",
        "TEST-CART-SVC-CLAMP",
        {
          stock: 3,
          allowBackorder: false,
        },
      );
      // Bypass the service's own add-time clamp to simulate stock dropping
      // after the item was already in the cart (e.g. another order sold it).
      await addToCart(cart.id, variant.id, 3);
      await recordMovement({
        variantId: variant.id,
        delta: -2,
        reason: "sale",
      });

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toHaveLength(1);
      expect(summary.lines[0]?.quantity).toBe(1);
      expect(summary.adjustments).toEqual([
        expect.objectContaining({
          type: "quantity_reduced",
          variantId: variant.id,
          requestedQuantity: 3,
          adjustedQuantity: 1,
        }),
      ]);

      const persisted = await listCartItemsByCartId(cart.id);
      expect(persisted[0]?.quantity).toBe(1);
    });

    it("does not clamp a made-to-order (backorder-enabled) line even at zero stock", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-backorder",
        "TEST-CART-SVC-BACKORDER",
        {
          stock: 0,
          allowBackorder: true,
        },
      );
      await addToCart(cart.id, variant.id, 4);

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toHaveLength(1);
      expect(summary.lines[0]?.quantity).toBe(4);
      expect(summary.lines[0]?.stock).toBe(0);
      expect(summary.adjustments).toEqual([]);
    });

    it("drops a line and reports it when stock hits zero with backorder off", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-soldout",
        "TEST-CART-SVC-SOLDOUT",
        {
          stock: 2,
          allowBackorder: false,
        },
      );
      await addToCart(cart.id, variant.id, 2);
      await recordMovement({
        variantId: variant.id,
        delta: -2,
        reason: "sale",
      });

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toEqual([]);
      expect(summary.adjustments).toEqual([
        expect.objectContaining({ type: "removed", variantId: variant.id }),
      ]);

      const persisted = await listCartItemsByCartId(cart.id);
      expect(persisted).toEqual([]);
    });

    it("drops a line and reports it when the variant is deactivated", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-deactivated",
        "TEST-CART-SVC-DEACTIVATED",
        { stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);
      await updateVariant(variant.id, { isActive: false });

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toEqual([]);
      expect(summary.adjustments).toEqual([
        expect.objectContaining({ type: "removed", variantId: variant.id }),
      ]);
    });

    it("drops a line and reports it when the product is no longer published", async () => {
      const cart = await makeCart();
      const { product, variant } = await makeVariant(
        "test-cart-svc-unpublished",
        "TEST-CART-SVC-UNPUBLISHED",
        { stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);
      await updateProduct(product.id, { status: "draft" });

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toEqual([]);
      expect(summary.adjustments).toEqual([
        expect.objectContaining({ type: "removed", variantId: variant.id }),
      ]);
    });

    it("sums multiple lines into the subtotal", async () => {
      const cart = await makeCart();
      const { variant: a } = await makeVariant(
        "test-cart-svc-multi-a",
        "TEST-CART-SVC-MULTI-A",
        {
          priceCents: 1000,
          stock: 5,
        },
      );
      const { variant: b } = await makeVariant(
        "test-cart-svc-multi-b",
        "TEST-CART-SVC-MULTI-B",
        {
          priceCents: 2500,
          stock: 5,
        },
      );
      await addToCart(cart.id, a.id, 2);
      await addToCart(cart.id, b.id, 1);

      const summary = await getCartSummary(cart.id);

      expect(summary.lines).toHaveLength(2);
      expect(summary.subtotalCents).toBe(1000 * 2 + 2500 * 1);
    });
  });

  describe("addToCart", () => {
    it("creates a new line for a first add", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-add-new",
        "TEST-CART-SVC-ADD-NEW",
        {
          stock: 5,
        },
      );

      const result = await addToCart(cart.id, variant.id, 2);

      expect(result).toEqual({
        ok: true,
        requestedQuantity: 2,
        adjustedQuantity: 2,
      });
      const items = await listCartItemsByCartId(cart.id);
      expect(items[0]?.quantity).toBe(2);
    });

    it("increments an existing line rather than overwriting it", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-add-increment",
        "TEST-CART-SVC-ADD-INCREMENT",
        { stock: 10 },
      );

      await addToCart(cart.id, variant.id, 2);
      const result = await addToCart(cart.id, variant.id, 3);

      expect(result).toEqual({
        ok: true,
        requestedQuantity: 5,
        adjustedQuantity: 5,
      });
      const items = await listCartItemsByCartId(cart.id);
      expect(items).toHaveLength(1);
      expect(items[0]?.quantity).toBe(5);
    });

    it("clamps the add to available stock and reports the adjusted quantity", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-add-clamp",
        "TEST-CART-SVC-ADD-CLAMP",
        { stock: 2, allowBackorder: false },
      );

      const result = await addToCart(cart.id, variant.id, 5);

      expect(result).toEqual({
        ok: true,
        requestedQuantity: 5,
        adjustedQuantity: 2,
      });
    });

    it("refuses to add a variant that is out of stock with backorder off", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-add-soldout",
        "TEST-CART-SVC-ADD-SOLDOUT",
        { stock: 0, allowBackorder: false },
      );

      const result = await addToCart(cart.id, variant.id, 1);

      expect(result).toEqual({ ok: false, reason: "unavailable" });
      const items = await listCartItemsByCartId(cart.id);
      expect(items).toEqual([]);
    });

    it("refuses to add a variant belonging to an unpublished product", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-add-draft",
        "TEST-CART-SVC-ADD-DRAFT",
        { stock: 5, status: "draft" },
      );

      const result = await addToCart(cart.id, variant.id, 1);

      expect(result).toEqual({ ok: false, reason: "unavailable" });
    });

    it("refuses to add an unknown variant id", async () => {
      const cart = await makeCart();

      const result = await addToCart(
        cart.id,
        "00000000-0000-0000-0000-000000000000",
        1,
      );

      expect(result).toEqual({ ok: false, reason: "unavailable" });
    });
  });

  describe("updateCartItemQuantity", () => {
    it("sets the line to an exact quantity within stock", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-update-set",
        "TEST-CART-SVC-UPDATE-SET",
        { stock: 10 },
      );
      await addToCart(cart.id, variant.id, 1);

      const result = await updateCartItemQuantity(cart.id, variant.id, 4);

      expect(result).toEqual({ ok: true, adjustedQuantity: 4, removed: false });
      const items = await listCartItemsByCartId(cart.id);
      expect(items[0]?.quantity).toBe(4);
    });

    it("clamps an update above available stock", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-update-clamp",
        "TEST-CART-SVC-UPDATE-CLAMP",
        { stock: 3, allowBackorder: false },
      );
      await addToCart(cart.id, variant.id, 1);

      const result = await updateCartItemQuantity(cart.id, variant.id, 10);

      expect(result).toEqual({ ok: true, adjustedQuantity: 3, removed: false });
    });

    it("removes the line when set to zero", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-update-zero",
        "TEST-CART-SVC-UPDATE-ZERO",
        { stock: 5 },
      );
      await addToCart(cart.id, variant.id, 2);

      const result = await updateCartItemQuantity(cart.id, variant.id, 0);

      expect(result).toEqual({ ok: true, adjustedQuantity: 0, removed: true });
      const items = await listCartItemsByCartId(cart.id);
      expect(items).toEqual([]);
    });

    it("removes the line when set to a negative quantity", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-update-negative",
        "TEST-CART-SVC-UPDATE-NEGATIVE",
        { stock: 5 },
      );
      await addToCart(cart.id, variant.id, 2);

      const result = await updateCartItemQuantity(cart.id, variant.id, -1);

      expect(result).toEqual({ ok: true, adjustedQuantity: 0, removed: true });
    });

    it("refuses to update a variant that is no longer available", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-update-unavailable",
        "TEST-CART-SVC-UPDATE-UNAVAILABLE",
        { stock: 5, isActive: false },
      );

      const result = await updateCartItemQuantity(cart.id, variant.id, 2);

      expect(result).toEqual({ ok: false, reason: "unavailable" });
    });
  });

  describe("discount codes", () => {
    it("applies a valid code and reflects it in the next summary read", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-apply",
        "TEST-CART-SVC-DISCOUNT-APPLY",
        { priceCents: 1000, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 2); // subtotal 2000
      const code = await insertDiscountCode({
        code: "APPLYME",
        kind: "percent",
        value: 10,
      });

      const result = await applyDiscountCode(cart.id, "APPLYME");
      expect(result).toEqual({ ok: true, discountCents: 200 });

      const summary = await getCartSummary(cart.id);
      expect(summary.discountCents).toBe(200);
      expect(summary.totalCents).toBe(1800);
      expect(summary.appliedDiscountCode).toEqual({
        id: code.id,
        code: "APPLYME",
      });
      expect(summary.adjustments).toEqual([]);
    });

    it("rejects an unknown code and leaves the cart without a discount", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-unknown",
        "TEST-CART-SVC-DISCOUNT-UNKNOWN",
        { priceCents: 1000, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);

      const result = await applyDiscountCode(cart.id, "NOPE");

      expect(result).toEqual({ ok: false, reason: "not_found" });
      const summary = await getCartSummary(cart.id);
      expect(summary.discountCents).toBe(0);
      expect(summary.appliedDiscountCode).toBeNull();
    });

    it("rejects a code below its minimum spend without applying it", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-minspend",
        "TEST-CART-SVC-DISCOUNT-MINSPEND",
        { priceCents: 500, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1); // subtotal 500
      await insertDiscountCode({
        code: "BIGSPEND",
        kind: "fixed",
        value: 100,
        minSpendCents: 5000,
      });

      const result = await applyDiscountCode(cart.id, "BIGSPEND");

      expect(result).toEqual({ ok: false, reason: "min_spend_not_met" });
      const summary = await getCartSummary(cart.id);
      expect(summary.appliedDiscountCode).toBeNull();
    });

    it("applying a second valid code replaces the first", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-replace",
        "TEST-CART-SVC-DISCOUNT-REPLACE",
        { priceCents: 1000, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);
      await insertDiscountCode({ code: "FIRST", kind: "fixed", value: 100 });
      const second = await insertDiscountCode({
        code: "SECOND",
        kind: "fixed",
        value: 200,
      });

      await applyDiscountCode(cart.id, "FIRST");
      await applyDiscountCode(cart.id, "SECOND");

      const summary = await getCartSummary(cart.id);
      expect(summary.appliedDiscountCode).toEqual({
        id: second.id,
        code: "SECOND",
      });
      expect(summary.discountCents).toBe(200);
    });

    it("removes an applied discount code", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-remove",
        "TEST-CART-SVC-DISCOUNT-REMOVE",
        { priceCents: 1000, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);
      await insertDiscountCode({ code: "GONE", kind: "fixed", value: 100 });
      await applyDiscountCode(cart.id, "GONE");

      await removeDiscountCode(cart.id);

      const summary = await getCartSummary(cart.id);
      expect(summary.appliedDiscountCode).toBeNull();
      expect(summary.discountCents).toBe(0);
    });

    it("auto-clears an applied code that's since become exhausted, and reports it", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-discount-exhausted",
        "TEST-CART-SVC-DISCOUNT-EXHAUSTED",
        { priceCents: 1000, stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);
      const code = await insertDiscountCode({
        code: "USEDUP",
        kind: "fixed",
        value: 100,
        maxUses: 1,
      });
      await applyDiscountCode(cart.id, "USEDUP");
      // Simulate the code being exhausted by another checkout in the
      // meantime, without going through this cart's own redemption path.
      await db
        .update(discountCodes)
        .set({ timesUsed: 1 })
        .where(eq(discountCodes.id, code.id));

      const summary = await getCartSummary(cart.id);

      expect(summary.appliedDiscountCode).toBeNull();
      expect(summary.discountCents).toBe(0);
      expect(summary.adjustments).toEqual([
        expect.objectContaining({
          type: "discount_removed",
          code: "USEDUP",
          reason: "exhausted",
        }),
      ]);

      // The clear is persisted, not just reported for this one read.
      const again = await getCartSummary(cart.id);
      expect(again.adjustments).toEqual([]);
    });
  });

  describe("removeFromCart", () => {
    it("removes an existing line", async () => {
      const cart = await makeCart();
      const { variant } = await makeVariant(
        "test-cart-svc-remove",
        "TEST-CART-SVC-REMOVE",
        { stock: 5 },
      );
      await addToCart(cart.id, variant.id, 1);

      await removeFromCart(cart.id, variant.id);

      const items = await listCartItemsByCartId(cart.id);
      expect(items).toEqual([]);
    });

    it("is a no-op for a variant not in the cart", async () => {
      const cart = await makeCart();

      await expect(
        removeFromCart(cart.id, "00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
    });
  });
});
