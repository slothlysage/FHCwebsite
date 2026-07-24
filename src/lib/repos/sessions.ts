import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";

type Session = typeof sessions.$inferSelect;
type NewSession = typeof sessions.$inferInsert;

export async function createSession(session: NewSession): Promise<Session> {
  const [created] = await db.insert(sessions).values(session).returning();
  return created!;
}

export async function getSessionByTokenHash(
  tokenHash: string,
): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash));
  return row;
}

export async function revokeSession(
  id: string,
  revokedAt: Date,
): Promise<Session> {
  const [updated] = await db
    .update(sessions)
    .set({ revokedAt })
    .where(eq(sessions.id, id))
    .returning();
  return updated!;
}
