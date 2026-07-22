import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { orderItems, orders } from "@/lib/db/schema";

type Order = typeof orders.$inferSelect;
type NewOrder = typeof orders.$inferInsert;
type OrderStatus = Order["status"];
type NewOrderItem = typeof orderItems.$inferInsert;

export async function createOrder(
  order: NewOrder,
  items: Array<Omit<NewOrderItem, "orderId">>,
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(orders).values(order).returning();
    const createdOrder = created!;

    if (items.length > 0) {
      await tx
        .insert(orderItems)
        .values(items.map((item) => ({ ...item, orderId: createdOrder.id })));
    }

    return createdOrder;
  });
}

export async function getOrderById(id: string): Promise<Order | undefined> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  return order;
}

export async function getOrderByStripeSessionId(
  stripeSessionId: string,
): Promise<Order | undefined> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeSessionId, stripeSessionId));
  return order;
}

export async function listOrdersByStatus(
  status: OrderStatus,
): Promise<Order[]> {
  return db.select().from(orders).where(eq(orders.status, status));
}

export async function updateOrder(
  id: string,
  patch: Partial<NewOrder>,
): Promise<Order | undefined> {
  const [updated] = await db
    .update(orders)
    .set(patch)
    .where(eq(orders.id, id))
    .returning();
  return updated;
}
