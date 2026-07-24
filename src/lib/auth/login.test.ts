import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";
import { createAdminUser } from "@/lib/repos/admin-users";
import { attemptLogin } from "@/lib/auth/login";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("attemptLogin", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(adminUsers).where(eq(adminUsers.id, id));
    }
  });

  async function seedAdmin(
    email: string,
    password: string,
    extra: Partial<typeof adminUsers.$inferInsert> = {},
  ) {
    const passwordHash = await hashPassword(password);
    const created = await createAdminUser({ email, passwordHash, ...extra });
    insertedIds.push(created.id);
    return created;
  }

  it("succeeds with the correct email and password", async () => {
    const admin = await seedAdmin("owner@example.com", "correct horse battery");

    const result = await attemptLogin(
      "owner@example.com",
      "correct horse battery",
    );

    expect(result).toEqual({ ok: true, adminUserId: admin.id });
  });

  it("resets failed attempts and stamps last_login_at on success", async () => {
    const admin = await seedAdmin(
      "resets@example.com",
      "correct horse battery",
      {
        failedAttempts: 3,
      },
    );

    await attemptLogin("resets@example.com", "correct horse battery");

    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    expect(row?.failedAttempts).toBe(0);
    expect(row?.lastLoginAt).not.toBeNull();
  });

  it("rejects the wrong password with a generic reason", async () => {
    await seedAdmin("wrongpw@example.com", "correct horse battery");

    const result = await attemptLogin(
      "wrongpw@example.com",
      "not the password",
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rejects an unknown email with the same generic reason as a wrong password", async () => {
    const result = await attemptLogin("nobody@example.com", "whatever");

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("increments failed_attempts on a wrong password", async () => {
    const admin = await seedAdmin(
      "increments@example.com",
      "correct horse battery",
    );

    await attemptLogin("increments@example.com", "wrong");

    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    expect(row?.failedAttempts).toBe(1);
  });

  it("locks the account after the 5th consecutive failed attempt", async () => {
    const admin = await seedAdmin(
      "lockme@example.com",
      "correct horse battery",
      {
        failedAttempts: 4,
      },
    );

    const result = await attemptLogin("lockme@example.com", "wrong");

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    expect(row?.failedAttempts).toBe(5);
    expect(row?.lockedUntil).not.toBeNull();
  });

  it("rejects a locked account without checking the password", async () => {
    await seedAdmin("locked@example.com", "correct horse battery", {
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await attemptLogin(
      "locked@example.com",
      "correct horse battery",
    );

    expect(result).toEqual({ ok: false, reason: "locked" });
  });

  it("allows login again once the lock has expired, and resets the counter", async () => {
    const admin = await seedAdmin(
      "expiredlock@example.com",
      "correct horse battery",
      {
        failedAttempts: 5,
        lockedUntil: new Date(Date.now() - 1000),
      },
    );

    const result = await attemptLogin(
      "expiredlock@example.com",
      "correct horse battery",
    );

    expect(result).toEqual({ ok: true, adminUserId: admin.id });
    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    expect(row?.failedAttempts).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });

  it("does not immediately re-lock on the first fresh failure after an expired lock", async () => {
    const admin = await seedAdmin(
      "freshwindow@example.com",
      "correct horse battery",
      {
        failedAttempts: 5,
        lockedUntil: new Date(Date.now() - 1000),
      },
    );

    const result = await attemptLogin("freshwindow@example.com", "wrong");

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    expect(row?.failedAttempts).toBe(1);
    expect(row?.lockedUntil).toBeNull();
  });
});
