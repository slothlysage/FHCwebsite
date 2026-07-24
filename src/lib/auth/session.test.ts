import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { adminUsers, sessions } from "@/lib/db/schema";
import {
  issueSession,
  revokeSessionByToken,
  rotateSession,
  verifySession,
} from "@/lib/auth/session";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("session service", () => {
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

  it("issues a session with a random token and a 7-day expiry", async () => {
    const user = await createTestAdminUser("issue@example.com");
    const before = Date.now();

    const { token, session } = await issueSession(user.id);

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(session.adminUserId).toBe(user.id);
    expect(session.revokedAt).toBeNull();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + sevenDaysMs - 5000,
    );
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
      before + sevenDaysMs + 5000,
    );
  });

  it("issues two sessions for the same user with different tokens", async () => {
    const user = await createTestAdminUser("issue-twice@example.com");

    const first = await issueSession(user.id);
    const second = await issueSession(user.id);

    expect(first.token).not.toBe(second.token);
    expect(first.session.tokenHash).not.toBe(second.session.tokenHash);
  });

  it("verifies a freshly issued session as valid", async () => {
    const user = await createTestAdminUser("verify-valid@example.com");
    const { token } = await issueSession(user.id);

    const result = await verifySession(token);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.session.adminUserId).toBe(user.id);
    }
  });

  it("rejects a token that doesn't match any session", async () => {
    const result = await verifySession("not-a-real-token");

    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("rejects an expired session", async () => {
    const user = await createTestAdminUser("verify-expired@example.com");
    const { token } = await issueSession(user.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await verifySession(token);

    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a revoked session", async () => {
    const user = await createTestAdminUser("verify-revoked@example.com");
    const { token } = await issueSession(user.id);
    await revokeSessionByToken(token);

    const result = await verifySession(token);

    expect(result).toEqual({ valid: false, reason: "revoked" });
  });

  it("rotation revokes the old session and issues a valid new one", async () => {
    const user = await createTestAdminUser("rotate@example.com");
    const { token: oldToken } = await issueSession(user.id);

    const { token: newToken } = await rotateSession(user.id, oldToken);

    const oldResult = await verifySession(oldToken);
    const newResult = await verifySession(newToken);

    expect(oldResult).toEqual({ valid: false, reason: "revoked" });
    expect(newResult.valid).toBe(true);
  });

  it("rotation with no previous token just issues a new session", async () => {
    const user = await createTestAdminUser("rotate-fresh@example.com");

    const { token } = await rotateSession(user.id, undefined);

    const result = await verifySession(token);
    expect(result.valid).toBe(true);
  });

  it("revoking by token is a no-op for an unknown token", async () => {
    await expect(
      revokeSessionByToken("unknown-token"),
    ).resolves.toBeUndefined();
  });
});
