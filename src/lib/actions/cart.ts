"use server";

import { revalidatePath } from "next/cache";

import { readCartId, writeCartId } from "@/lib/cart-cookie";
import { createCart, getCartById } from "@/lib/repos/cart";
import {
  addToCart,
  removeFromCart,
  updateCartItemQuantity,
} from "@/lib/services/cart";
import {
  parseAddToCartForm,
  parseRemoveCartItemForm,
  parseUpdateCartItemForm,
} from "@/lib/validation/cart-form";

// Lives in `lib/`, not `app/`, so both routes (the cart page) and components
// (the product page's Add to cart button, VariantSelector) can import it
// without a components -> app dependency. Thin orchestration only — the
// business logic (pricing, clamping, availability) stays in
// `lib/services/cart.ts`, matching AGENT.md's "routes are thin" rule applied
// to this action layer too.

// Only valid to call from within a Server Action (this module) — reads the
// cart_id cookie, verifying the cart it points to still exists (e.g. after a
// db:reset wiped it), and creates + persists a new one otherwise. Server
// Components must not create carts on a plain read (see cart-cookie.ts and
// site-header.tsx), so this stays private to the mutation actions below.
async function getOrCreateCartId(): Promise<string> {
  const existing = await readCartId();
  if (existing && (await getCartById(existing))) {
    return existing;
  }
  const cart = await createCart();
  await writeCartId(cart.id);
  return cart.id;
}

// Every action revalidates the whole tree, not just /cart — the header's
// item count (site-header.tsx) is rendered on every route via the root
// layout, so an add/update/remove anywhere must refresh it everywhere.
function revalidateCart(): void {
  revalidatePath("/", "layout");
}

export async function addToCartAction(formData: FormData): Promise<void> {
  const parsed = parseAddToCartForm(formData);
  if (!parsed.success) {
    return;
  }
  const cartId = await getOrCreateCartId();
  await addToCart(cartId, parsed.data.variantId, parsed.data.quantity);
  revalidateCart();
}

export async function updateCartItemAction(formData: FormData): Promise<void> {
  const parsed = parseUpdateCartItemForm(formData);
  if (!parsed.success) {
    return;
  }
  const cartId = await getOrCreateCartId();
  await updateCartItemQuantity(
    cartId,
    parsed.data.variantId,
    parsed.data.quantity,
  );
  revalidateCart();
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  const parsed = parseRemoveCartItemForm(formData);
  if (!parsed.success) {
    return;
  }
  const cartId = await getOrCreateCartId();
  await removeFromCart(cartId, parsed.data.variantId);
  revalidateCart();
}
