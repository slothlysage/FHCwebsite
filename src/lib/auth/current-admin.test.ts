import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

import { db } from "@/lib/db/client";
import { adminUsers, sessions } from "@/lib/db/schema";
import { issueSession, revokeSessionByToken } from "@/lib/auth/session";
import {
  ADMIN_SESSION_COOKIE_NAME,
  writeAdminSessionToken,
} from "@/lib/auth/session-cookie";
import { getCurrentAdminUserId } from "@/lib/auth/current-admin";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("getCurrentAdminUserId", () => {
  const insertedUserIds: string[] = [];

  beforeEach(() => {
    cookieStore.clear();
  });

  afterEach(async () => {
    for (const id of insertedUserIds.splice(0)) {
      await db.delete(sessions).where(eq(sessions.adminUserId, id));
      await db.delete(adminUsers).where(eq(adminUsers.id, id));
    }
  });

  async function createTestAdminUser(email: string) {
    const [created] = await db
      .insert(adminUsers)
      .values({ email, passwordHash: "hash-placeholder" })
      .returning();
    insertedUserIds.push(created!.id);
    return created!;
  }

  it("returns undefined when there is no session cookie", async () => {
    expect(await getCurrentAdminUserId()).toBeUndefined();
  });

  it("returns undefined when the cookie doesn't match any session", async () => {
    cookieStore.set(ADMIN_SESSION_COOKIE_NAME, "not-a-real-token");

    expect(await getCurrentAdminUserId()).toBeUndefined();
  });

  it("returns undefined when the session is revoked", async () => {
    const user = await createTestAdminUser(
      `current-admin-revoked-${Date.now()}@example.com`,
    );
    const { token } = await issueSession(user.id);
    await revokeSessionByToken(token);
    await writeAdminSessionToken(token);

    expect(await getCurrentAdminUserId()).toBeUndefined();
  });

  it("returns the admin user id for a valid session cookie", async () => {
    const user = await createTestAdminUser(
      `current-admin-valid-${Date.now()}@example.com`,
    );
    const { token } = await issueSession(user.id);
    await writeAdminSessionToken(token);

    expect(await getCurrentAdminUserId()).toBe(user.id);
  });
});
