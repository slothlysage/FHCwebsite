import Link from "next/link";

import { formatPriceCents } from "@/lib/format";
import {
  getOrderByStripeSessionId,
  getOrderItemsByOrderId,
} from "@/lib/repos/orders";

// Order data changes independently of deploys and this page is keyed by a
// live query param, not something Next could usefully prerender — same
// rationale as every other catalog/order-backed route (2.2, 2.5, cart).
export const dynamic = "force-dynamic";

// Reads nothing but the order this session already paid for — no order,
// order item, or inventory write happens here (that's the webhook's job,
// src/lib/services/order-fulfillment.ts). A reload can never duplicate
// anything by construction: there is no write path on this page at all.
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  const order = sessionId
    ? await getOrderByStripeSessionId(sessionId)
    : undefined;

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Thanks for your order
        </h1>
        <p className="mt-4 text-sm text-ink/70">
          We&apos;re finishing up your confirmation — refresh this page in a
          moment. A receipt is on its way to your email.
        </p>
      </div>
    );
  }

  const items = await getOrderItemsByOrderId(order.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Thanks for your order
      </h1>
      <p className="mt-2 text-sm text-ink/70">
        Order #{order.orderNumber} — a receipt was sent to {order.email}.
      </p>

      <ul className="mt-8 divide-y divide-sand">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="font-medium text-ink">{item.productNameSnapshot}</p>
              <p className="text-sm text-ink/70">
                {item.variantNameSnapshot} × {item.quantity}
              </p>
              {item.oversoldQuantity > 0 && (
                <p className="text-xs text-clay-dark">Made to order</p>
              )}
            </div>
            <p className="text-sm font-medium text-ink">
              {formatPriceCents(item.lineTotalCents)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-1 text-sm text-ink">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{formatPriceCents(order.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Shipping</dt>
          <dd>{formatPriceCents(order.shippingCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax</dt>
          <dd>{formatPriceCents(order.taxCents)}</dd>
        </div>
        {order.discountCents > 0 && (
          <div className="flex justify-between">
            <dt>Discount</dt>
            <dd>-{formatPriceCents(order.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd>{formatPriceCents(order.totalCents)}</dd>
        </div>
      </dl>

      <Link
        href="/products"
        className="mt-8 inline-block underline hover:text-clay"
      >
        Continue shopping
      </Link>
    </div>
  );
}
