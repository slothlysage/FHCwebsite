import {
  getCartItem,
  listCartItemsByCartId,
  removeCartItem,
  upsertCartItem,
} from "@/lib/repos/cart";
import { getStockForVariant, getStockForVariants } from "@/lib/repos/inventory";
import { getProductById } from "@/lib/repos/products";
import { getVariantById } from "@/lib/repos/variants";
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
    };

export type CartSummary = {
  cartId: string;
  lines: CartLine[];
  subtotalCents: number;
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

// Re-prices and re-clamps every stored cart_items row against the live
// catalog on every read (specs/03-storefront.md: never trust a client-held
// cart; re-price and re-clamp on read; tell the user rather than silently
// adjusting). Any clamp or removal found here is persisted back to
// cart_items so an unchanged cart doesn't get re-reported on the next read.
export async function getCartSummary(cartId: string): Promise<CartSummary> {
  const items = await listCartItemsByCartId(cartId);
  if (items.length === 0) {
    return { cartId, lines: [], subtotalCents: 0, adjustments: [] };
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

  return { cartId, lines, subtotalCents, adjustments };
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
