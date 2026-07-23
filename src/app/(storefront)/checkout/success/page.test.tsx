import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import { orderItems, orders } from "@/lib/db/schema";
import { createOrder, listOrdersByStatus } from "@/lib/repos/orders";
import CheckoutSuccessPage from "./page";

// Integration test against the real dev database (specs/06-testing.md) — an
// async Server Component, invoked directly and awaited rather than rendered
// as JSX, same pattern as products/page.test.tsx.

function withSessionId(sessionId?: string) {
  return CheckoutSuccessPage({
    searchParams: Promise.resolve({ session_id: sessionId }),
  });
}

describe("CheckoutSuccessPage", () => {
  const insertedOrderIds: string[] = [];

  afterEach(async () => {
    for (const orderId of insertedOrderIds.splice(0)) {
      await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
      await db.delete(orders).where(eq(orders.id, orderId));
    }
  });

  it("renders the order's items and totals for a known session id", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(
      {
        email: "buyer@example.com",
        status: "paid",
        subtotalCents: 2000,
        shippingCents: 500,
        taxCents: 150,
        totalCents: 2650,
        stripeSessionId,
        paidAt: new Date(),
      },
      [
        {
          variantId: null,
          productNameSnapshot: "Lavender Candle",
          variantNameSnapshot: "8oz",
          skuSnapshot: "LAV-8OZ",
          unitPriceCents: 2000,
          quantity: 1,
          lineTotalCents: 2000,
        },
      ],
    );
    insertedOrderIds.push(order.id);

    render(await withSessionId(stripeSessionId));

    expect(
      screen.getByText(new RegExp(`#${order.orderNumber}`)),
    ).toBeInTheDocument();
    expect(screen.getByText("Lavender Candle")).toBeInTheDocument();
    expect(screen.getByText("$26.50")).toBeInTheDocument();
  });

  it("shows a processing message, not an error, when no order is found yet", async () => {
    render(await withSessionId(`cs_test_${randomUUID()}`));

    expect(screen.getByText(/finishing up/i)).toBeInTheDocument();
  });

  it("shows a processing message when session_id is missing entirely", async () => {
    render(await withSessionId(undefined));

    expect(screen.getByText(/finishing up/i)).toBeInTheDocument();
  });

  it("refreshing the page does not create or duplicate any order", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(
      {
        email: "buyer@example.com",
        status: "paid",
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        stripeSessionId,
        paidAt: new Date(),
      },
      [],
    );
    insertedOrderIds.push(order.id);

    const before = await listOrdersByStatus("paid");
    render(await withSessionId(stripeSessionId));
    render(await withSessionId(stripeSessionId));
    const after = await listOrdersByStatus("paid");

    expect(after.length).toBe(before.length);
  });
});
