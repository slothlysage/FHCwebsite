import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { adminUsers, sessions } from "@/lib/db/schema";
import {
  createSession,
  getSessionByTokenHash,
  revokeSession,
} from "@/lib/repos/sessions";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("sessions repo", () => {
  const insertedUserIds: string[] = [];

  async function createTestAdminUser(email: string) {
    const [created] = await db
      .insert(adminUsers)
      .values({ email, passwordHash: "hash-placeholder" })
      .returning();
    insertedUserIds.push(created!.id);
    return created!;
  }

  afterEach(async () => {
    for (const id of insertedUserIds.splice(0)) {
      await db.delete(sessions).where(eq(sessions.adminUserId, id));
      await db.delete(adminUsers).where(eq(adminUsers.id, id));
    }
  });

  it("creates a session", async () => {
    const user = await createTestAdminUser("session-create@example.com");
    const expiresAt = new Date(Date.now() + 60_000);

    const created = await createSession({
      adminUserId: user.id,
      tokenHash: "hash-abc",
      expiresAt,
      ip: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(created.adminUserId).toBe(user.id);
    expect(created.tokenHash).toBe("hash-abc");
    expect(created.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(created.revokedAt).toBeNull();
  });

  it("finds a session by token hash", async () => {
    const user = await createTestAdminUser("session-find@example.com");
    const created = await createSession({
      adminUserId: user.id,
      tokenHash: "hash-find-me",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = await getSessionByTokenHash("hash-find-me");
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for a token hash that doesn't exist", async () => {
    const found = await getSessionByTokenHash("hash-nonexistent");
    expect(found).toBeUndefined();
  });

  it("revokes a session", async () => {
    const user = await createTestAdminUser("session-revoke@example.com");
    const created = await createSession({
      adminUserId: user.id,
      tokenHash: "hash-revoke-me",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const revokedAt = new Date();
    const updated = await revokeSession(created.id, revokedAt);

    expect(updated.revokedAt?.getTime()).toBe(revokedAt.getTime());
  });
});
