// Admin login credential check (specs/04-admin.md's Auth section, task 4.1a).
// Session issuance/cookies/CSRF are a separate concern (4.1b) — this module
// only decides whether an email+password pair is currently allowed in.
import { verifyPassword } from "@/lib/auth/password";
import {
  clearExpiredLock,
  getAdminUserByEmail,
  recordFailedLoginAttempt,
  resetLoginAttempts,
} from "@/lib/repos/admin-users";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// A fixed, valid argon2id hash (real params, arbitrary password, never used
// as a real credential) so a lookup for an email that doesn't exist still
// pays the same argon2 cost as a real one — without this, a wrong-email
// request would return near-instantly while a wrong-password request takes
// ~argon2's full runtime, leaking which emails have accounts via timing.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$xGqv3JWpwkRlZKP0ZABc5g$/a0rhl37PatuZSVMppFVN9Td4/mF8CCFLuawZ2P73iw";

export type LoginResult =
  | { ok: true; adminUserId: string }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export async function attemptLogin(
  email: string,
  password: string,
): Promise<LoginResult> {
  const now = new Date();
  let user = await getAdminUserByEmail(email);

  if (user?.lockedUntil) {
    if (user.lockedUntil > now) {
      return { ok: false, reason: "locked" };
    }
    // The lock has expired — start a fresh attempt window before deciding
    // anything else, so this request's own outcome is evaluated against a
    // clean counter, not the stale pre-lock one.
    user = await clearExpiredLock(user.id);
  }

  const valid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !valid) {
    if (user) {
      const lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
      await recordFailedLoginAttempt(user.id, MAX_FAILED_ATTEMPTS, lockUntil);
    }
    // Identical reason for "no such user" and "wrong password" — specs/
    // 04-admin.md's "identical error message for ... both" requirement.
    return { ok: false, reason: "invalid_credentials" };
  }

  await resetLoginAttempts(user.id, now);
  return { ok: true, adminUserId: user.id };
}
