import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";
import {
  clearExpiredLock,
  createAdminUser,
  getAdminUserByEmail,
  recordFailedLoginAttempt,
  resetLoginAttempts,
} from "@/lib/repos/admin-users";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("admin-users repo", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(adminUsers).where(eq(adminUsers.id, id));
    }
  });

  it("creates an admin user", async () => {
    const created = await createAdminUser({
      email: "owner@example.com",
      passwordHash: "hash-placeholder",
    });
    insertedIds.push(created.id);

    expect(created.email).toBe("owner@example.com");
    expect(created.failedAttempts).toBe(0);
    expect(created.lockedUntil).toBeNull();
  });

  it("finds an admin user by exact-match email", async () => {
    const created = await createAdminUser({
      email: "find-me@example.com",
      passwordHash: "hash-placeholder",
    });
    insertedIds.push(created.id);

    const found = await getAdminUserByEmail("find-me@example.com");
    expect(found?.id).toBe(created.id);
  });

  it("does not find an admin user by a differently-cased email", async () => {
    const created = await createAdminUser({
      email: "casesensitive@example.com",
      passwordHash: "hash-placeholder",
    });
    insertedIds.push(created.id);

    const found = await getAdminUserByEmail("CaseSensitive@example.com");
    expect(found).toBeUndefined();
  });

  it("returns undefined for an email that doesn't exist", async () => {
    const found = await getAdminUserByEmail("nobody@example.com");
    expect(found).toBeUndefined();
  });

  it("increments failed attempts without locking below the threshold", async () => {
    const created = await createAdminUser({
      email: "attempts@example.com",
      passwordHash: "hash-placeholder",
    });
    insertedIds.push(created.id);

    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    const updated = await recordFailedLoginAttempt(created.id, 5, lockUntil);

    expect(updated.failedAttempts).toBe(1);
    expect(updated.lockedUntil).toBeNull();
  });

  it("locks the account once failed attempts reach the threshold", async () => {
    const created = await createAdminUser({
      email: "lockout@example.com",
      passwordHash: "hash-placeholder",
      failedAttempts: 4,
    });
    insertedIds.push(created.id);

    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    const updated = await recordFailedLoginAttempt(created.id, 5, lockUntil);

    expect(updated.failedAttempts).toBe(5);
    expect(updated.lockedUntil?.getTime()).toBe(lockUntil.getTime());
  });

  it("increments failed attempts atomically under concurrent calls", async () => {
    const created = await createAdminUser({
      email: "concurrent@example.com",
      passwordHash: "hash-placeholder",
    });
    insertedIds.push(created.id);

    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    await Promise.all([
      recordFailedLoginAttempt(created.id, 5, lockUntil),
      recordFailedLoginAttempt(created.id, 5, lockUntil),
      recordFailedLoginAttempt(created.id, 5, lockUntil),
    ]);

    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, created.id));
    expect(row?.failedAttempts).toBe(3);
  });

  it("resets failed attempts and lock, and stamps last login, on success", async () => {
    const created = await createAdminUser({
      email: "success@example.com",
      passwordHash: "hash-placeholder",
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    insertedIds.push(created.id);

    const loginAt = new Date();
    const updated = await resetLoginAttempts(created.id, loginAt);

    expect(updated.failedAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    expect(updated.lastLoginAt?.getTime()).toBe(loginAt.getTime());
  });

  it("clears an expired lock and resets the attempt counter", async () => {
    const created = await createAdminUser({
      email: "expiredlock@example.com",
      passwordHash: "hash-placeholder",
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });
    insertedIds.push(created.id);

    const updated = await clearExpiredLock(created.id);

    expect(updated.failedAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });
});
