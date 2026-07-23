import { z } from "zod";

// Server Actions accept arbitrary FormData from any POST, not just our own
// markup (AGENT.md: zod at every external boundary, form input included).
// Same permissive-parsing convention as product-filters.ts: a malformed or
// missing field falls back to a safe default rather than throwing/500ing —
// the fallback for quantity is chosen to match what the cart *service*
// already does with that value, not a new failure mode.

const variantIdSchema = z.string().uuid();

export const addToCartFormSchema = z.object({
  variantId: variantIdSchema,
  // Missing/non-numeric/non-positive -> add one, the natural default for an
  // "Add to cart" button with no quantity input.
  quantity: z.coerce.number().int().positive().catch(1),
});

export const updateCartItemFormSchema = z.object({
  variantId: variantIdSchema,
  // Missing/non-numeric -> 0, which the cart service already treats as
  // "remove this line" — not a new branch, just the safe default.
  quantity: z.coerce.number().int().catch(0),
});

export const removeCartItemFormSchema = z.object({
  variantId: variantIdSchema,
});

export function parseAddToCartForm(formData: FormData) {
  return addToCartFormSchema.safeParse({
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity"),
  });
}

export function parseUpdateCartItemForm(formData: FormData) {
  return updateCartItemFormSchema.safeParse({
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity"),
  });
}

export function parseRemoveCartItemForm(formData: FormData) {
  return removeCartItemFormSchema.safeParse({
    variantId: formData.get("variantId"),
  });
}
