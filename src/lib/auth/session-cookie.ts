// Admin session cookie I/O (specs/04-admin.md's Auth section, task 4.1c).
// Mirrors src/lib/cart-cookie.ts's shape and next/headers usage exactly —
// only valid to call from a Server Action or Route Handler, mockable the
// same way in tests.
import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches session.ts's SESSION_DURATION_MS.

export async function readAdminSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ADMIN_SESSION_COOKIE_NAME)?.value;
}

export async function writeAdminSessionToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Only forced off in dev, where `next dev` serves plain http and a
    // Secure cookie would silently never be stored by the browser.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearAdminSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE_NAME);
}
