import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { cartItems, carts } from "@/lib/db/schema";

type Cart = typeof carts.$inferSelect;
type CartItem = typeof cartItems.$inferSelect;

export async function createCart(executor: DbExecutor = db): Promise<Cart> {
  const [cart] = await executor.insert(carts).values({}).returning();
  return cart!;
}

export async function getCartById(
  id: string,
  executor: DbExecutor = db,
): Promise<Cart | undefined> {
  const [cart] = await executor.select().from(carts).where(eq(carts.id, id));
  return cart;
}

export async function listCartItemsByCartId(
  cartId: string,
  executor: DbExecutor = db,
): Promise<CartItem[]> {
  return executor.select().from(cartItems).where(eq(cartItems.cartId, cartId));
}

export async function getCartItem(
  cartId: string,
  variantId: string,
  executor: DbExecutor = db,
): Promise<CartItem | undefined> {
  const [item] = await executor
    .select()
    .from(cartItems)
    .where(
      and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)),
    );
  return item;
}

// Sets the item's quantity to exactly the given value — not an increment.
// Callers (the cart service) decide the final quantity after their own
// stock-clamping logic, so this only needs to persist it. onConflictDoUpdate
// on the (cart_id, variant_id) unique index is what makes adding an
// already-present variant update its one row instead of creating a second.
export async function upsertCartItem(
  input: { cartId: string; variantId: string; quantity: number },
  executor: DbExecutor = db,
): Promise<CartItem> {
  const [item] = await executor
    .insert(cartItems)
    .values(input)
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: { quantity: input.quantity, updatedAt: new Date() },
    })
    .returning();
  return item!;
}

export async function removeCartItem(
  cartId: string,
  variantId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .delete(cartItems)
    .where(
      and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)),
    );
}

// Empties a cart after a successful checkout (specs/05-payments.md:
// "checkout.session.completed" -> "empty cart"). Deletes every item row but
// leaves the cart row itself, since the cart_id cookie keeps pointing at it.
export async function deleteCartItemsByCartId(
  cartId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.delete(cartItems).where(eq(cartItems.cartId, cartId));
}
