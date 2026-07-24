import Link from "next/link";

import { readCartId } from "@/lib/cart-cookie";
import { formatPriceCents } from "@/lib/format";
import { getCartSummary, type CartSummary } from "@/lib/services/cart";
import {
  applyDiscountCodeAction,
  removeCartItemAction,
  removeDiscountCodeAction,
  updateCartItemAction,
} from "@/lib/actions/cart";
import { createCheckoutSessionAction } from "@/lib/actions/checkout";

// Reads cookies() (via readCartId) — Next opts this route into dynamic
// rendering for that reason alone, but the explicit export documents intent
// the same way every other catalog-dependent route in this app does
// (AGENT.md: the database is the source of truth for catalog/inventory).
export const dynamic = "force-dynamic";

async function loadCartSummary(): Promise<CartSummary> {
  const cartId = await readCartId();
  if (!cartId) {
    return {
      cartId: "",
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
      appliedDiscountCode: null,
      adjustments: [],
    };
  }
  return getCartSummary(cartId);
}

function adjustmentMessage(
  adjustment: CartSummary["adjustments"][number],
): string {
  if (adjustment.type === "removed") {
    return `${adjustment.productName} is no longer available and was removed from your cart.`;
  }
  if (adjustment.type === "quantity_reduced") {
    return `${adjustment.productName} quantity was reduced to ${adjustment.adjustedQuantity} (limited stock).`;
  }
  return `Discount code ${adjustment.code} is no longer valid and was removed.`;
}

// `applyDiscountCodeAction`'s (src/lib/actions/cart.ts) redirect reasons —
// `validateDiscountCode`'s (3.8a) rejection reasons plus the action's own
// `"invalid_code"` sentinel for a blank/missing form field.
const DISCOUNT_ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "Enter a discount code to apply it.",
  not_found: "That discount code doesn't exist.",
  inactive: "That discount code is no longer available.",
  not_started: "That discount code isn't active yet.",
  expired: "That discount code has expired.",
  exhausted: "That discount code is no longer available (usage limit reached).",
  min_spend_not_met:
    "Your cart subtotal doesn't meet that code's minimum spend.",
};

function discountErrorMessage(reason: string | undefined): string | null {
  if (!reason) {
    return null;
  }
  return (
    DISCOUNT_ERROR_MESSAGES[reason] ?? "That discount code couldn't be applied."
  );
}

// `checkout_error`'s two values are `createCheckoutSession`'s (3.3)
// `CreateCheckoutSessionResult["reason"]` — surfaced here rather than left
// as a silent redirect back to /cart. "empty_cart" only round-trips if the
// cart emptied between this page rendering and the button being clicked
// (e.g. a second tab); "unavailable" means a cart line's variant hasn't
// been synced to Stripe yet (specs/05-payments.md's "Implementation notes
// (3.3)").
function checkoutErrorMessage(reason: string | undefined): string | null {
  if (reason === "unavailable") {
    return "Some items in your cart aren't available for checkout right now. Please try again shortly.";
  }
  if (reason === "empty_cart") {
    return "Your cart emptied before checkout could start.";
  }
  return null;
}

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout_error?: string; discount_error?: string }>;
}) {
  const summary = await loadCartSummary();
  const { checkout_error: checkoutError, discount_error: discountError } =
    await searchParams;
  const checkoutErrorText = checkoutErrorMessage(checkoutError);
  const discountErrorText = discountErrorMessage(discountError);
  // Fresh per render, embedded in the checkout form below: two submits of
  // the same rendered page (e.g. a double-click) reuse this value and so
  // resolve to the same Stripe idempotency key, but a reload or a return
  // trip from a cancelled session gets a new one (specs/05-payments.md's
  // "Implementation notes (3.3)").
  const checkoutNonce = crypto.randomUUID();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Your cart
      </h1>

      {checkoutErrorText && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {checkoutErrorText}
        </p>
      )}

      {discountErrorText && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {discountErrorText}
        </p>
      )}

      {summary.adjustments.length > 0 && (
        <ul
          role="status"
          className="mt-4 space-y-1 rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {summary.adjustments.map((adjustment, index) => (
            <li
              key={
                adjustment.type === "discount_removed"
                  ? `discount-${adjustment.code}`
                  : `${adjustment.type}-${adjustment.variantId}-${index}`
              }
            >
              {adjustmentMessage(adjustment)}
            </li>
          ))}
        </ul>
      )}

      {summary.lines.length === 0 ? (
        <p className="mt-8 text-sm text-ink/70">
          Your cart is empty.{" "}
          <Link href="/products" className="underline hover:text-sage-dark">
            Continue shopping
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-8 divide-y divide-sand">
            {summary.lines.map((line) => (
              <li
                key={line.variantId}
                className="flex flex-wrap items-center gap-4 py-4"
              >
                <div className="flex-1">
                  <Link
                    href={`/products/${line.productSlug}`}
                    className="font-medium text-ink hover:text-sage-dark"
                  >
                    {line.productName}
                  </Link>
                  <p className="text-sm text-ink/70">{line.variantName}</p>
                  <p className="text-sm text-ink/70">
                    {formatPriceCents(line.priceCents)} each
                  </p>
                  {line.stock <= 0 && line.allowBackorder && (
                    <p className="text-xs text-lavender-dark">Made to order</p>
                  )}
                </div>

                <form
                  action={updateCartItemAction}
                  className="flex items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="variantId"
                    value={line.variantId}
                  />
                  <div>
                    <label
                      htmlFor={`quantity-${line.variantId}`}
                      className="block text-xs font-medium text-ink"
                    >
                      Quantity
                    </label>
                    <input
                      id={`quantity-${line.variantId}`}
                      type="number"
                      name="quantity"
                      min={0}
                      defaultValue={line.quantity}
                      className="mt-1 w-16 rounded-md border border-ink/20 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md border border-ink/20 px-3 py-1.5 text-sm"
                  >
                    Update
                  </button>
                </form>

                <form action={removeCartItemAction}>
                  <input
                    type="hidden"
                    name="variantId"
                    value={line.variantId}
                  />
                  <button
                    type="submit"
                    aria-label={`Remove ${line.productName} from cart`}
                    className="text-sm font-medium text-lavender-dark underline"
                  >
                    Remove
                  </button>
                </form>

                <p className="w-24 text-right text-sm font-medium text-ink">
                  {formatPriceCents(line.lineTotalCents)}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col items-end gap-3">
            {summary.appliedDiscountCode ? (
              <div className="flex items-center gap-3 text-sm text-ink">
                <span>
                  Discount code{" "}
                  <span className="font-medium">
                    {summary.appliedDiscountCode.code}
                  </span>
                </span>
                <form action={removeDiscountCodeAction}>
                  <button
                    type="submit"
                    aria-label={`Remove discount code ${summary.appliedDiscountCode.code}`}
                    className="font-medium text-lavender-dark underline"
                  >
                    Remove discount code
                  </button>
                </form>
              </div>
            ) : (
              <form
                action={applyDiscountCodeAction}
                className="flex items-end gap-2"
              >
                <div>
                  <label
                    htmlFor="discount-code"
                    className="block text-xs font-medium text-ink"
                  >
                    Discount code
                  </label>
                  <input
                    id="discount-code"
                    type="text"
                    name="code"
                    className="mt-1 w-40 rounded-md border border-ink/20 px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-md border border-ink/20 px-3 py-1.5 text-sm"
                >
                  Apply
                </button>
              </form>
            )}

            <div className="flex justify-end gap-4 text-sm text-ink">
              <span>Subtotal</span>
              <span>{formatPriceCents(summary.subtotalCents)}</span>
            </div>
            {summary.discountCents > 0 && (
              <div className="flex justify-end gap-4 text-sm text-ink">
                <span>Discount</span>
                <span>-{formatPriceCents(summary.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-end gap-4 text-lg font-semibold text-ink">
              <span>Total</span>
              <span>{formatPriceCents(summary.totalCents)}</span>
            </div>
          </div>

          <form
            action={createCheckoutSessionAction}
            className="mt-6 flex justify-end"
          >
            <input type="hidden" name="nonce" value={checkoutNonce} />
            <button
              type="submit"
              className="rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
            >
              Checkout
            </button>
          </form>
        </>
      )}
    </div>
  );
}
