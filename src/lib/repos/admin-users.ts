import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

type AdminUser = typeof adminUsers.$inferSelect;
type NewAdminUser = typeof adminUsers.$inferInsert;

export async function createAdminUser(user: NewAdminUser): Promise<AdminUser> {
  const [created] = await db.insert(adminUsers).values(user).returning();
  return created!;
}

// Exact-match only — there's no case-insensitive index on admin_users.email
// (unlike discount_codes.code), and with a single seeded admin account
// there's no ambiguity to normalize away.
export async function getAdminUserByEmail(
  email: string,
): Promise<AdminUser | undefined> {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email));
  return row;
}

// Atomic `failed_attempts + 1`, with the lock decision made in the same SQL
// statement (a CASE, not a read-then-write) so two concurrent failed
// attempts can't both read "4" and neither trigger the lock — the same
// atomicity rationale as discount-codes.ts's incrementDiscountCodeUsage.
export async function recordFailedLoginAttempt(
  id: string,
  maxAttempts: number,
  lockUntil: Date,
): Promise<AdminUser> {
  const [updated] = await db
    .update(adminUsers)
    .set({
      failedAttempts: sql`${adminUsers.failedAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${adminUsers.failedAttempts} + 1 >= ${maxAttempts} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${adminUsers.lockedUntil} END`,
    })
    .where(eq(adminUsers.id, id))
    .returning();
  return updated!;
}

// Successful login: clear the failed-attempt window entirely and stamp
// last_login_at.
export async function resetLoginAttempts(
  id: string,
  lastLoginAt: Date,
): Promise<AdminUser> {
  const [updated] = await db
    .update(adminUsers)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt })
    .where(eq(adminUsers.id, id))
    .returning();
  return updated!;
}

// A lock whose `locked_until` has passed starts a fresh attempt window —
// called by the login service before evaluating credentials so an account
// doesn't stay perpetually one-failure-from-relocking forever.
export async function clearExpiredLock(id: string): Promise<AdminUser> {
  const [updated] = await db
    .update(adminUsers)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(adminUsers.id, id))
    .returning();
  return updated!;
}
