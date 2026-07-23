import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";

type NewWebhookEvent = typeof webhookEvents.$inferInsert;

// specs/05-payments.md's whole idempotency mechanism: insert the Stripe
// event id first, before any processing. `onConflictDoNothing` + checking
// whether a row actually came back is the drizzle-idiomatic way to detect
// "already seen" without hand-catching a raw Postgres unique-violation
// error — a replayed event returns an empty array here, never throws.
export async function insertWebhookEvent(
  input: NewWebhookEvent,
  executor: DbExecutor = db,
): Promise<boolean> {
  const rows = await executor
    .insert(webhookEvents)
    .values(input)
    .onConflictDoNothing({ target: webhookEvents.stripeEventId })
    .returning();
  return rows.length > 0;
}

export async function markWebhookEventProcessed(
  stripeEventId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.stripeEventId, stripeEventId));
}
