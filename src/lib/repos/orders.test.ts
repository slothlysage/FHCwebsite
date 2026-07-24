import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { orderItems, orders } from "@/lib/db/schema";
import {
  createOrder,
  getOrderById,
  getOrderByStripePaymentIntentId,
  getOrderByStripeSessionId,
  getOrderItemsByOrderId,
  listOrders,
  listOrdersByStatus,
  updateOrder,
} from "@/lib/repos/orders";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("orders repo", () => {
  const insertedOrderIds: string[] = [];

  afterEach(async () => {
    for (const orderId of insertedOrderIds.splice(0)) {
      await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
      await db.delete(orders).where(eq(orders.id, orderId));
    }
  });

  function baseOrder(stripeSessionId: string): typeof orders.$inferInsert {
    return {
      email: "buyer@example.com",
      subtotalCents: 2000,
      shippingCents: 500,
      taxCents: 150,
      totalCents: 2650,
      stripeSessionId,
    };
  }

  it("creates an order with items atomically", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(baseOrder(stripeSessionId), [
      {
        variantId: null,
        productNameSnapshot: "Lavender Candle",
        variantNameSnapshot: "8oz",
        skuSnapshot: "LAV-8OZ",
        unitPriceCents: 2000,
        quantity: 1,
        lineTotalCents: 2000,
      },
    ]);
    insertedOrderIds.push(order.id);

    expect(order.stripeSessionId).toBe(stripeSessionId);
    expect(order.status).toBe("pending");

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(items).toHaveLength(1);
    expect(items[0]?.skuSnapshot).toBe("LAV-8OZ");
    // Not passed above — the column's default marks the line as fully
    // covered by stock unless checkout says otherwise.
    expect(items[0]?.oversoldQuantity).toBe(0);
  });

  it("persists an item's oversold quantity for made-to-order sales", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(baseOrder(stripeSessionId), [
      {
        variantId: null,
        productNameSnapshot: "Lavender Candle",
        variantNameSnapshot: "8oz",
        skuSnapshot: "LAV-8OZ-OVERSOLD",
        unitPriceCents: 2000,
        quantity: 3,
        lineTotalCents: 6000,
        // 3 ordered, 1 on hand → 2 produced to order.
        oversoldQuantity: 2,
      },
    ]);
    insertedOrderIds.push(order.id);

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(items[0]?.oversoldQuantity).toBe(2);
  });

  it("rolls back the order and items when an item insert fails", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const marker = `ATOMIC-TEST-SKU-${randomUUID()}`;

    await expect(
      createOrder(baseOrder(stripeSessionId), [
        {
          // References a variant that doesn't exist — violates the FK and
          // must fail the whole transaction, not just this row.
          variantId: randomUUID(),
          productNameSnapshot: "Ghost Product",
          variantNameSnapshot: "Ghost Variant",
          skuSnapshot: marker,
          unitPriceCents: 1000,
          quantity: 1,
          lineTotalCents: 1000,
        },
      ]),
    ).rejects.toThrow();

    const order = await getOrderByStripeSessionId(stripeSessionId);
    expect(order).toBeUndefined();

    const orphanedItems = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.skuSnapshot, marker));
    expect(orphanedItems).toHaveLength(0);
  });

  it("gets an order by id", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const created = await createOrder(baseOrder(stripeSessionId), []);
    insertedOrderIds.push(created.id);

    const found = await getOrderById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for a nonexistent order id", async () => {
    const found = await getOrderById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("gets an order by stripe session id", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const created = await createOrder(baseOrder(stripeSessionId), []);
    insertedOrderIds.push(created.id);

    const found = await getOrderByStripeSessionId(stripeSessionId);
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for an unknown stripe session id", async () => {
    const found = await getOrderByStripeSessionId(`cs_test_${randomUUID()}`);
    expect(found).toBeUndefined();
  });

  it("gets an order by stripe payment intent id", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const paymentIntentId = `pi_test_${randomUUID()}`;
    const created = await createOrder(
      { ...baseOrder(stripeSessionId), stripePaymentIntentId: paymentIntentId },
      [],
    );
    insertedOrderIds.push(created.id);

    const found = await getOrderByStripePaymentIntentId(paymentIntentId);
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for an unknown stripe payment intent id", async () => {
    const found = await getOrderByStripePaymentIntentId(
      `pi_test_${randomUUID()}`,
    );
    expect(found).toBeUndefined();
  });

  it("lists orders filtered by status", async () => {
    const pendingSessionId = `cs_test_${randomUUID()}`;
    const paidSessionId = `cs_test_${randomUUID()}`;

    const pending = await createOrder(baseOrder(pendingSessionId), []);
    insertedOrderIds.push(pending.id);
    const paidOrder = await createOrder(baseOrder(paidSessionId), []);
    insertedOrderIds.push(paidOrder.id);
    await updateOrder(paidOrder.id, { status: "paid", paidAt: new Date() });

    const paidOrders = await listOrdersByStatus("paid");
    const paidIds = paidOrders.map((o) => o.id);

    expect(paidIds).toContain(paidOrder.id);
    expect(paidIds).not.toContain(pending.id);
  });

  it("gets order items by order id", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(baseOrder(stripeSessionId), [
      {
        variantId: null,
        productNameSnapshot: "Lavender Candle",
        variantNameSnapshot: "8oz",
        skuSnapshot: "LAV-8OZ",
        unitPriceCents: 2000,
        quantity: 1,
        lineTotalCents: 2000,
      },
    ]);
    insertedOrderIds.push(order.id);

    const items = await getOrderItemsByOrderId(order.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.skuSnapshot).toBe("LAV-8OZ");
  });

  it("returns an empty array for an order with no items", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const order = await createOrder(baseOrder(stripeSessionId), []);
    insertedOrderIds.push(order.id);

    const items = await getOrderItemsByOrderId(order.id);
    expect(items).toEqual([]);
  });

  it("updates order status and timestamps", async () => {
    const stripeSessionId = `cs_test_${randomUUID()}`;
    const created = await createOrder(baseOrder(stripeSessionId), []);
    insertedOrderIds.push(created.id);

    const paidAt = new Date();
    const updated = await updateOrder(created.id, {
      status: "paid",
      paidAt,
    });
    expect(updated?.status).toBe("paid");
    expect(updated?.paidAt?.getTime()).toBe(paidAt.getTime());

    const fulfilledAt = new Date();
    const fulfilled = await updateOrder(created.id, {
      status: "fulfilled",
      fulfilledAt,
    });
    expect(fulfilled?.status).toBe("fulfilled");
    expect(fulfilled?.fulfilledAt?.getTime()).toBe(fulfilledAt.getTime());
  });

  describe("listOrders", () => {
    it("filters by status", async () => {
      const pendingSessionId = `cs_test_${randomUUID()}`;
      const paidSessionId = `cs_test_${randomUUID()}`;

      const pending = await createOrder(baseOrder(pendingSessionId), []);
      insertedOrderIds.push(pending.id);
      const paidOrder = await createOrder(baseOrder(paidSessionId), []);
      insertedOrderIds.push(paidOrder.id);
      await updateOrder(paidOrder.id, { status: "paid", paidAt: new Date() });

      const paidOrders = await listOrders({ status: "paid" });
      const paidIds = paidOrders.map((o) => o.id);

      expect(paidIds).toContain(paidOrder.id);
      expect(paidIds).not.toContain(pending.id);
    });

    it("searches by a partial email match", async () => {
      const stripeSessionId = `cs_test_${randomUUID()}`;
      const marker = randomUUID();
      const order = await createOrder(
        {
          ...baseOrder(stripeSessionId),
          email: `search-target-${marker}@example.com`,
        },
        [],
      );
      insertedOrderIds.push(order.id);

      const matches = await listOrders({ search: marker });
      expect(matches.map((o) => o.id)).toContain(order.id);

      const nonMatches = await listOrders({ search: randomUUID() });
      expect(nonMatches.map((o) => o.id)).not.toContain(order.id);
    });

    it("searches by a partial order number match", async () => {
      const stripeSessionId = `cs_test_${randomUUID()}`;
      const order = await createOrder(baseOrder(stripeSessionId), []);
      insertedOrderIds.push(order.id);

      const matches = await listOrders({
        search: String(order.orderNumber),
      });
      expect(matches.map((o) => o.id)).toContain(order.id);
    });

    it("combines status and search filters", async () => {
      const stripeSessionId = `cs_test_${randomUUID()}`;
      const marker = randomUUID();
      const order = await createOrder(
        {
          ...baseOrder(stripeSessionId),
          email: `combo-${marker}@example.com`,
        },
        [],
      );
      insertedOrderIds.push(order.id);

      const noMatch = await listOrders({ status: "paid", search: marker });
      expect(noMatch.map((o) => o.id)).not.toContain(order.id);

      const match = await listOrders({ status: "pending", search: marker });
      expect(match.map((o) => o.id)).toContain(order.id);
    });

    it("returns every order newest-first when no filters are given", async () => {
      const olderSessionId = `cs_test_${randomUUID()}`;
      const newerSessionId = `cs_test_${randomUUID()}`;

      const older = await createOrder(baseOrder(olderSessionId), []);
      insertedOrderIds.push(older.id);
      const newer = await createOrder(baseOrder(newerSessionId), []);
      insertedOrderIds.push(newer.id);

      const all = await listOrders();
      const olderIndex = all.findIndex((o) => o.id === older.id);
      const newerIndex = all.findIndex((o) => o.id === newer.id);

      expect(newerIndex).toBeGreaterThanOrEqual(0);
      expect(olderIndex).toBeGreaterThan(newerIndex);
    });
  });
});
