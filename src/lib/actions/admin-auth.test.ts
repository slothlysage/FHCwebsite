import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));
const sessionCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@/lib/auth/csrf-cookie", () => ({
  readCsrfCookie: vi.fn(async () => csrfCookie.token),
}));

vi.mock("@/lib/auth/session-cookie", () => ({
  readAdminSessionToken: vi.fn(async () => sessionCookie.token),
  writeAdminSessionToken: vi.fn(async (token: string) => {
    sessionCookie.token = token;
  }),
  clearAdminSessionToken: vi.fn(async () => {
    sessionCookie.token = undefined;
  }),
}));

// Mirrors how Next actually behaves (`redirect()`'s real type is `(url:
// string) => never` — it throws internally to unwind the action), same
// mocking pattern as checkout.test.ts. Matters for correctness here too:
// loginAction's guard clauses call `redirect()` without an explicit
// `return`, so a non-throwing mock would fall through into the next
// statement instead of stopping.
class TestRedirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new TestRedirect(url);
  }),
}));

import { generateCsrfToken } from "@/lib/auth/csrf-token";
import { hashPassword } from "@/lib/auth/password";
import { verifySession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { adminUsers, sessions } from "@/lib/db/schema";
import { createAdminUser } from "@/lib/repos/admin-users";

import { loginAction, logoutAction } from "./admin-auth";

// Integration tests against the real dev database — same convention as
// cart.test.ts: only the Next cookie-reading modules are mocked (they
// require a real request/action context), everything else (password
// hashing, credential check, session issuance/revocation) runs for real.

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("admin auth actions", () => {
  // Unique per test run, not a fixed literal — vitest runs test files in
  // separate workers against the same shared dev database, and other files
  // (admin-users.test.ts, login.test.ts) also seed an "owner@example.com"
  // row; a fixed email here raced with them and hit the unique constraint.
  const email = `owner-${randomUUID()}@example.com`;
  const password = "correct horse battery staple";
  let adminUserId: string;

  beforeEach(async () => {
    csrfCookie.token = undefined;
    sessionCookie.token = undefined;
    const passwordHash = await hashPassword(password);
    const user = await createAdminUser({ email, passwordHash });
    adminUserId = user.id;
  });

  afterEach(async () => {
    await db.delete(sessions).where(eq(sessions.adminUserId, adminUserId));
    await db.delete(adminUsers).where(eq(adminUsers.id, adminUserId));
  });

  describe("loginAction", () => {
    it("redirects to the login page with a csrf_mismatch error when the csrf field doesn't match the cookie", async () => {
      csrfCookie.token = generateCsrfToken();
      await expect(
        loginAction(formData({ email, password, csrfToken: "wrong-token" })),
      ).rejects.toThrow("REDIRECT:/admin/login?error=csrf_mismatch");
      expect(sessionCookie.token).toBeUndefined();
    });

    it("redirects to the login page with a csrf_mismatch error when there is no csrf cookie at all", async () => {
      const token = generateCsrfToken();
      await expect(
        loginAction(formData({ email, password, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin/login?error=csrf_mismatch");
    });

    it("redirects with an invalid_credentials error when the password field is missing, with a matching csrf token", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;
      await expect(
        loginAction(formData({ email, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin/login?error=invalid_credentials");
    });

    it("redirects with an invalid_credentials error for the wrong password, with a matching csrf token", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;
      await expect(
        loginAction(formData({ email, password: "nope", csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin/login?error=invalid_credentials");
    });

    it("logs in with correct credentials and a matching csrf token, issuing a session cookie and redirecting to /admin", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;
      await expect(
        loginAction(formData({ email, password, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin");
      expect(sessionCookie.token).toBeTruthy();

      const verified = await verifySession(sessionCookie.token!);
      expect(verified).toEqual(expect.objectContaining({ valid: true }));
    });

    it("rotates an existing (even expired) session cookie into a new one on login", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;

      // First login issues session A.
      await expect(
        loginAction(formData({ email, password, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin");
      const firstToken = sessionCookie.token!;

      // Logging in again while that cookie is presented rotates it: the old
      // token stops verifying, a new one takes its place.
      await expect(
        loginAction(formData({ email, password, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin");
      const secondToken = sessionCookie.token!;
      expect(secondToken).not.toBe(firstToken);

      expect(await verifySession(firstToken)).toEqual({
        valid: false,
        reason: "revoked",
      });
      expect(await verifySession(secondToken)).toEqual(
        expect.objectContaining({ valid: true }),
      );
    });
  });

  describe("logoutAction", () => {
    it("rejects a request whose csrf field doesn't match the cookie", async () => {
      csrfCookie.token = generateCsrfToken();
      const result = await logoutAction(formData({ csrfToken: "wrong-token" }));
      expect(result).toEqual({ ok: false, reason: "csrf_mismatch" });
    });

    it("revokes the current session so it no longer verifies on the next request, and clears the cookie", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;
      await expect(
        loginAction(formData({ email, password, csrfToken: token })),
      ).rejects.toThrow("REDIRECT:/admin");
      const issuedToken = sessionCookie.token!;
      expect(await verifySession(issuedToken)).toEqual(
        expect.objectContaining({ valid: true }),
      );

      const result = await logoutAction(formData({ csrfToken: token }));
      expect(result).toEqual({ ok: true });
      expect(sessionCookie.token).toBeUndefined();

      // Server-side revocation: the same token no longer verifies, proving
      // logout invalidated it at the database, not just cleared the cookie.
      expect(await verifySession(issuedToken)).toEqual({
        valid: false,
        reason: "revoked",
      });
    });

    it("is a no-op (still succeeds) when there is no session cookie to revoke", async () => {
      const token = generateCsrfToken();
      csrfCookie.token = token;
      const result = await logoutAction(formData({ csrfToken: token }));
      expect(result).toEqual({ ok: true });
    });
  });
});
