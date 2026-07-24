import {
  getCartById,
  getCartItem,
  listCartItemsByCartId,
  removeCartItem,
  setCartDiscountCode,
  upsertCartItem,
} from "@/lib/repos/cart";
import { getDiscountCodeById } from "@/lib/repos/discount-codes";
import { getStockForVariant, getStockForVariants } from "@/lib/repos/inventory";
import { getProductById } from "@/lib/repos/products";
import { getVariantById } from "@/lib/repos/variants";
import {
  validateDiscountCode,
  type DiscountRejectReason,
} from "@/lib/services/discount";
import type { products, productVariants } from "@/lib/db/schema";

type Variant = typeof productVariants.$inferSelect;
type Product = typeof products.$inferSelect;

export type CartLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  sku: string;
  priceCents: number;
  quantity: number;
  lineTotalCents: number;
  weightGrams: number;
  stock: number;
  allowBackorder: boolean;
  // Null until the variant has been synced to Stripe (3.2's
  // `runStripeSync`). Checkout (3.3) treats a cart containing an unsynced
  // line as not yet purchasable rather than falling back to an ad-hoc
  // Stripe price, so the amount charged always traces back to the one
  // Stripe Price object this variant is known by.
  stripePriceId: string | null;
};

export type CartAdjustment =
  | { type: "removed"; variantId: string; productName: string }
  | {
      type: "quantity_reduced";
      variantId: string;
      productName: string;
      requestedQuantity: number;
      adjustedQuantity: number;
    }
  | {
      type: "discount_removed";
      code: string;
      reason: DiscountRejectReason;
    };

export type CartSummary = {
  cartId: string;
  lines: CartLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  appliedDiscountCode: { id: string; code: string } | null;
  adjustments: CartAdjustment[];
};

// A variant is purchasable through the storefront only if it's active and its
// product is published and not soft-deleted — the same contract
// product-detail.ts (2.5) already enforces for direct product access, applied
// here so a cart line can't outlive a product being unpublished/deactivated.
function isVariantAvailable(
  variant: Variant | undefined,
  product: Product | undefined,
): variant is Variant {
  return (
    variant !== undefined &&
    variant.isActive &&
    product !== undefined &&
    product.status === "published" &&
    !product.deletedAt
  );
}

// The one clamping rule, shared by every mutation and by getCartSummary's
// read-time re-clamp: made-to-order (allowBackorder) variants have no upper
// bound (1.7), everything else is capped at live stock. Never negative.
function clampQuantity(
  requested: number,
  stock: number,
  allowBackorder: boolean,
): number {
  if (allowBackorder) {
    return Math.max(requested, 0);
  }
  return Math.max(Math.min(requested, stock), 0);
}

async function loadAvailableVariant(
  variantId: string,
): Promise<{ variant: Variant; product: Product } | null> {
  const variant = await getVariantById(variantId);
  const product = variant ? await getProductById(variant.productId) : undefined;
  if (!isVariantAvailable(variant, product)) {
    return null;
  }
  return { variant, product: product! };
}

// Re-validates a cart's stored discount_code_id against the live subtotal
// (task 3.8b) — the same "never trust stored state, re-derive" rule this
// module already applies to stock/price. A code that's gone invalid since
// it was applied (expired, exhausted by another checkout, subtotal dropped
// below min-spend) is cleared here, not left dangling, and reported as an
// adjustment the same way a dropped cart line is.
async function resolveDiscount(
  cartId: string,
  discountCodeId: string | null,
  subtotalCents: number,
): Promise<{
  discountCents: number;
  appliedDiscountCode: { id: string; code: string } | null;
  adjustment: CartAdjustment | null;
}> {
  if (!discountCodeId) {
    return { discountCents: 0, appliedDiscountCode: null, adjustment: null };
  }

  const discountCode = await getDiscountCodeById(discountCodeId);
  if (!discountCode) {
    await setCartDiscountCode(cartId, null);
    return { discountCents: 0, appliedDiscountCode: null, adjustment: null };
  }

  const result = await validateDiscountCode(discountCode.code, subtotalCents);
  if (!result.ok) {
    await setCartDiscountCode(cartId, null);
    return {
      discountCents: 0,
      appliedDiscountCode: null,
      adjustment: {
        type: "discount_removed",
        code: discountCode.code,
        reason: result.reason,
      },
    };
  }

  return {
    discountCents: result.discountCents,
    appliedDiscountCode: { id: discountCode.id, code: discountCode.code },
    adjustment: null,
  };
}

// The line/subtotal half of getCartSummary, factored out so
// applyDiscountCode can validate a new code against the cart's real
// (re-priced, re-clamped) subtotal instead of a second, divergent
// computation over raw cart_items quantities.
async function computeLinesAndSubtotal(cartId: string): Promise<{
  lines: CartLine[];
  subtotalCents: number;
  adjustments: CartAdjustment[];
}> {
  const items = await listCartItemsByCartId(cartId);
  if (items.length === 0) {
    return { lines: [], subtotalCents: 0, adjustments: [] };
  }

  const stockByVariant = await getStockForVariants(
    items.map((item) => item.variantId),
  );

  const lines: CartLine[] = [];
  const adjustments: CartAdjustment[] = [];

  for (const item of items) {
    const variant = await getVariantById(item.variantId);
    const product = variant
      ? await getProductById(variant.productId)
      : undefined;

    const fallbackName = product?.name ?? variant?.name ?? "This item";
    if (!isVariantAvailable(variant, product)) {
      await removeCartItem(cartId, item.variantId);
      adjustments.push({
        type: "removed",
        variantId: item.variantId,
        productName: fallbackName,
      });
      continue;
    }

    const stock = stockByVariant.get(item.variantId) ?? 0;
    const quantity = clampQuantity(
      item.quantity,
      stock,
      variant.allowBackorder,
    );

    if (quantity <= 0) {
      await removeCartItem(cartId, item.variantId);
      adjustments.push({
        type: "removed",
        variantId: item.variantId,
        productName: product!.name,
      });
      continue;
    }

    if (quantity !== item.quantity) {
      await upsertCartItem({ cartId, variantId: item.variantId, quantity });
      adjustments.push({
        type: "quantity_reduced",
        variantId: item.variantId,
        productName: product!.name,
        requestedQuantity: item.quantity,
        adjustedQuantity: quantity,
      });
    }

    lines.push({
      variantId: variant.id,
      productId: product!.id,
      productSlug: product!.slug,
      productName: product!.name,
      variantName: variant.name,
      sku: variant.sku,
      priceCents: variant.priceCents,
      quantity,
      lineTotalCents: variant.priceCents * quantity,
      weightGrams: variant.weightGrams,
      stock,
      allowBackorder: variant.allowBackorder,
      stripePriceId: variant.stripePriceId,
    });
  }

  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.lineTotalCents,
    0,
  );

  return { lines, subtotalCents, adjustments };
}

// Re-prices and re-clamps every stored cart_items row against the live
// catalog on every read (specs/03-storefront.md: never trust a client-held
// cart; re-price and re-clamp on read; tell the user rather than silently
// adjusting). Any clamp or removal found here is persisted back to
// cart_items so an unchanged cart doesn't get re-reported on the next read.
// Also re-validates the cart's applied discount code (task 3.8b) against the
// freshly-computed subtotal, the same "never trust stored state" rule.
export async function getCartSummary(cartId: string): Promise<CartSummary> {
  // Sequential, not Promise.all: this repo's pg.Pool has a fixed connection
  // cap, and every write path in this module (clamp/removal persistence
  // here, order-fulfillment's advisory-lock transaction elsewhere) already
  // competes for it under concurrent load. Running these two independent
  // reads back-to-back instead of in parallel keeps this function's
  // connection footprint the same as before task 3.8b added the second
  // read, rather than doubling the peak concurrent connections a single
  // getCartSummary call can hold at once.
  const cart = await getCartById(cartId);
  const { lines, subtotalCents, adjustments } =
    await computeLinesAndSubtotal(cartId);

  const { discountCents, appliedDiscountCode, adjustment } =
    await resolveDiscount(cartId, cart?.discountCodeId ?? null, subtotalCents);
  if (adjustment) {
    adjustments.push(adjustment);
  }

  return {
    cartId,
    lines,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    appliedDiscountCode,
    adjustments,
  };
}

export type AddToCartResult =
  | { ok: true; requestedQuantity: number; adjustedQuantity: number }
  | { ok: false; reason: "unavailable" };

// Adds to whatever quantity of this variant is already in the cart (not an
// absolute set — see 2.7a's NOTE on upsertCartItem). Clamped to live stock
// via the same rule getCartSummary re-applies on every read.
export async function addToCart(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<AddToCartResult> {
  const available = await loadAvailableVariant(variantId);
  if (!available) {
    return { ok: false, reason: "unavailable" };
  }
  const { variant } = available;

  const existing = await getCartItem(cartId, variantId);
  const requestedQuantity = (existing?.quantity ?? 0) + quantity;
  const stock = await getStockForVariant(variantId);
  const adjustedQuantity = clampQuantity(
    requestedQuantity,
    stock,
    variant.allowBackorder,
  );

  if (adjustedQuantity <= 0) {
    return { ok: false, reason: "unavailable" };
  }

  await upsertCartItem({ cartId, variantId, quantity: adjustedQuantity });

  return { ok: true, requestedQuantity, adjustedQuantity };
}

export type UpdateCartItemQuantityResult =
  | { ok: true; adjustedQuantity: number; removed: boolean }
  | { ok: false; reason: "unavailable" };

// Sets the line to an exact quantity (unlike addToCart's increment) — the
// cart page's quantity input replaces the value rather than adding to it.
// A quantity of zero or less removes the line, same as removeFromCart.
export async function updateCartItemQuantity(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<UpdateCartItemQuantityResult> {
  if (quantity <= 0) {
    await removeCartItem(cartId, variantId);
    return { ok: true, adjustedQuantity: 0, removed: true };
  }

  const available = await loadAvailableVariant(variantId);
  if (!available) {
    return { ok: false, reason: "unavailable" };
  }
  const { variant } = available;

  const stock = await getStockForVariant(variantId);
  const adjustedQuantity = clampQuantity(
    quantity,
    stock,
    variant.allowBackorder,
  );

  if (adjustedQuantity <= 0) {
    await removeCartItem(cartId, variantId);
    return { ok: true, adjustedQuantity: 0, removed: true };
  }

  await upsertCartItem({ cartId, variantId, quantity: adjustedQuantity });
  return { ok: true, adjustedQuantity, removed: false };
}

export async function removeFromCart(
  cartId: string,
  variantId: string,
): Promise<void> {
  await removeCartItem(cartId, variantId);
}

export type ApplyDiscountCodeResult =
  | { ok: true; discountCents: number }
  | { ok: false; reason: DiscountRejectReason };

// Validates against the cart's *current* line-item subtotal (not whatever
// getCartSummary last reported) and, on success, overwrites any
// already-applied code — a cart holds at most one at a time. On rejection
// the cart's existing discount_code_id (if any) is left untouched; the
// caller re-applying a bad code doesn't clear a previously-good one.
export async function applyDiscountCode(
  cartId: string,
  code: string,
): Promise<ApplyDiscountCodeResult> {
  const { subtotalCents } = await computeLinesAndSubtotal(cartId);

  const result = await validateDiscountCode(code, subtotalCents);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  await setCartDiscountCode(cartId, result.discountCodeId);
  return { ok: true, discountCents: result.discountCents };
}

export async function removeDiscountCode(cartId: string): Promise<void> {
  await setCartDiscountCode(cartId, null);
}
