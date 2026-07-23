import { describe, expect, it } from "vitest";

import { buildOrderReceiptEmail } from "@/lib/services/receipt";
import type { orderItems, orders } from "@/lib/db/schema";

type Order = typeof orders.$inferSelect;
type OrderItem = typeof orderItems.$inferSelect;

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    orderNumber: 42,
    email: "buyer@example.com",
    status: "paid",
    subtotalCents: 2000,
    shippingCents: 500,
    taxCents: 150,
    discountCents: 0,
    totalCents: 2650,
    currency: "usd",
    stripeSessionId: "cs_test_1",
    stripePaymentIntentId: null,
    shippingAddressId: null,
    billingAddressId: null,
    discountCodeId: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    paidAt: new Date("2026-01-01T00:00:00Z"),
    fulfilledAt: null,
    ...overrides,
  };
}

function baseItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item-1",
    orderId: "order-1",
    variantId: "variant-1",
    productNameSnapshot: "Lavender Candle",
    variantNameSnapshot: "8oz",
    skuSnapshot: "LAV-8OZ",
    unitPriceCents: 2000,
    quantity: 1,
    lineTotalCents: 2000,
    oversoldQuantity: 0,
    ...overrides,
  };
}

describe("buildOrderReceiptEmail", () => {
  it("includes the order number in the subject", () => {
    const email = buildOrderReceiptEmail(baseOrder(), [baseItem()]);
    expect(email.subject).toContain("#42");
  });

  it("renders each line item and the totals in both html and text", () => {
    const email = buildOrderReceiptEmail(baseOrder(), [baseItem()]);

    expect(email.text).toContain("Lavender Candle (8oz) x1 — $20.00");
    expect(email.text).toContain("Subtotal: $20.00");
    expect(email.text).toContain("Shipping: $5.00");
    expect(email.text).toContain("Tax: $1.50");
    expect(email.text).toContain("Total: $26.50");

    expect(email.html).toContain("Lavender Candle");
    expect(email.html).toContain("$20.00");
    expect(email.html).toContain("Total: $26.50");
  });

  it("omits the discount line when there is no discount", () => {
    const email = buildOrderReceiptEmail(baseOrder(), [baseItem()]);
    expect(email.text).not.toContain("Discount");
    expect(email.html).not.toContain("Discount");
  });

  it("includes the discount line when the order has one", () => {
    const email = buildOrderReceiptEmail(
      baseOrder({ discountCents: 300, totalCents: 2350 }),
      [baseItem()],
    );
    expect(email.text).toContain("Discount: -$3.00");
    expect(email.html).toContain("Discount: -$3.00");
  });

  it("notes a made-to-order line without flagging a fully-stocked one", () => {
    const email = buildOrderReceiptEmail(baseOrder(), [
      baseItem({ id: "item-1", oversoldQuantity: 0 }),
      baseItem({
        id: "item-2",
        skuSnapshot: "LAV-8OZ-MTO",
        oversoldQuantity: 2,
      }),
    ]);

    const madeToOrderCount = (email.text.match(/Made to order/g) ?? []).length;
    expect(madeToOrderCount).toBe(1);
    expect(email.html).toContain("Made to order");
  });

  it("escapes HTML in snapshot fields", () => {
    const email = buildOrderReceiptEmail(baseOrder(), [
      baseItem({ productNameSnapshot: `<script>alert("x")</script>` }),
    ]);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
