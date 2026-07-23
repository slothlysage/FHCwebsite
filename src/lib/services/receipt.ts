// Pure builder for the order-confirmation receipt (specs/05-payments.md's
// "Webhooks" table: checkout.session.completed → "... send receipt"). No
// network/db access here — src/lib/services/order-fulfillment.ts calls
// sendEmail (src/lib/email/send.ts) with this function's output, and the
// checkout success page renders its own JSX from the same order/items
// instead of reusing this HTML (a page needs live links/styling, not an
// email body).
import { formatPriceCents } from "@/lib/format";
import type { orderItems, orders } from "@/lib/db/schema";

type Order = typeof orders.$inferSelect;
type OrderItem = typeof orderItems.$inferSelect;

export type ReceiptEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A made-to-order (1.7) line — some or all of its quantity exceeded on-hand
// stock at sale time — gets a note in the receipt per 1.7's NOTE for 3.7:
// "the customer [should be told] the item is made to order."
function madeToOrderNote(item: OrderItem): string | null {
  return item.oversoldQuantity > 0
    ? "Made to order — this item ships once it's ready."
    : null;
}

export function buildOrderReceiptEmail(
  order: Order,
  items: OrderItem[],
): ReceiptEmail {
  const subject = `Your order #${order.orderNumber} is confirmed`;

  const textLines = items.map((item) => {
    const note = madeToOrderNote(item);
    const line = `- ${item.productNameSnapshot} (${item.variantNameSnapshot}) x${item.quantity} — ${formatPriceCents(item.lineTotalCents)}`;
    return note ? `${line}\n  ${note}` : line;
  });

  const text = [
    `Thanks for your order, #${order.orderNumber}!`,
    "",
    ...textLines,
    "",
    `Subtotal: ${formatPriceCents(order.subtotalCents)}`,
    `Shipping: ${formatPriceCents(order.shippingCents)}`,
    `Tax: ${formatPriceCents(order.taxCents)}`,
    ...(order.discountCents > 0
      ? [`Discount: -${formatPriceCents(order.discountCents)}`]
      : []),
    `Total: ${formatPriceCents(order.totalCents)}`,
  ].join("\n");

  const htmlItems = items
    .map((item) => {
      const note = madeToOrderNote(item);
      return `<li>${escapeHtml(item.productNameSnapshot)} (${escapeHtml(item.variantNameSnapshot)}) x${item.quantity} — ${formatPriceCents(item.lineTotalCents)}${note ? `<br><small>${escapeHtml(note)}</small>` : ""}</li>`;
    })
    .join("");

  const html = [
    `<p>Thanks for your order, #${order.orderNumber}!</p>`,
    `<ul>${htmlItems}</ul>`,
    `<p>Subtotal: ${formatPriceCents(order.subtotalCents)}<br>`,
    `Shipping: ${formatPriceCents(order.shippingCents)}<br>`,
    `Tax: ${formatPriceCents(order.taxCents)}<br>`,
    ...(order.discountCents > 0
      ? [`Discount: -${formatPriceCents(order.discountCents)}<br>`]
      : []),
    `Total: ${formatPriceCents(order.totalCents)}</p>`,
  ].join("");

  return { subject, html, text };
}
