import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { orderItems, orders } from "@/lib/db/schema";

type Order = typeof orders.$inferSelect;
type NewOrder = typeof orders.$inferInsert;
type OrderStatus = Order["status"];
type NewOrderItem = typeof orderItems.$inferInsert;

// Accepts an optional executor (a `withTransaction` callback's `tx`) so a
// caller with more writes to make atomic alongside this one — e.g.
// order-fulfillment.ts's inventory decrement + cart clear — can thread its
// own transaction through instead of getting a second, independent one.
// Called with no executor (the default), this still opens its own
// transaction so the order+items insert stays atomic on its own.
export async function createOrder(
  order: NewOrder,
  items: Array<Omit<NewOrderItem, "orderId">>,
  executor: DbExecutor = db,
): Promise<Order> {
  const insertOrderAndItems = async (tx: DbExecutor): Promise<Order> => {
    const [created] = await tx.insert(orders).values(order).returning();
    const createdOrder = created!;

    if (items.length > 0) {
      await tx
        .insert(orderItems)
        .values(items.map((item) => ({ ...item, orderId: createdOrder.id })));
    }

    return createdOrder;
  };

  return executor === db
    ? db.transaction(insertOrderAndItems)
    : insertOrderAndItems(executor);
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

export async function getOrderByStripePaymentIntentId(
  stripePaymentIntentId: string,
): Promise<Order | undefined> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripePaymentIntentId, stripePaymentIntentId));
  return order;
}

export async function getOrderItemsByOrderId(
  orderId: string,
): Promise<Array<typeof orderItems.$inferSelect>> {
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
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
