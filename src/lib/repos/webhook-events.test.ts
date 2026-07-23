import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import {
  insertWebhookEvent,
  markWebhookEventProcessed,
} from "@/lib/repos/webhook-events";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("webhook-events repo", () => {
  const insertedEventIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedEventIds.splice(0)) {
      await db.delete(webhookEvents).where(eq(webhookEvents.stripeEventId, id));
    }
  });

  it("inserts a new event and reports it as newly inserted", async () => {
    const id = `evt_test_new_${Date.now()}`;
    insertedEventIds.push(id);

    const inserted = await insertWebhookEvent({
      stripeEventId: id,
      type: "checkout.session.completed",
      payload: { id, type: "checkout.session.completed" },
    });

    expect(inserted).toBe(true);
    const [row] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, id));
    expect(row?.type).toBe("checkout.session.completed");
    expect(row?.processedAt).toBeNull();
  });

  it("reports false and writes nothing new on a replayed event id", async () => {
    const id = `evt_test_replay_${Date.now()}`;
    insertedEventIds.push(id);

    const first = await insertWebhookEvent({
      stripeEventId: id,
      type: "checkout.session.completed",
      payload: { id },
    });
    const second = await insertWebhookEvent({
      stripeEventId: id,
      type: "checkout.session.completed",
      payload: { id },
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, id));
    expect(rows).toHaveLength(1);
  });

  it("marks an event processed", async () => {
    const id = `evt_test_processed_${Date.now()}`;
    insertedEventIds.push(id);
    await insertWebhookEvent({
      stripeEventId: id,
      type: "checkout.session.completed",
      payload: { id },
    });

    await markWebhookEventProcessed(id);

    const [row] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, id));
    expect(row?.processedAt).toBeInstanceOf(Date);
  });
});
