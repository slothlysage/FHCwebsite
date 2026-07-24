import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";
import { issueSession } from "@/lib/auth/session";
import { ADMIN_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { db } from "@/lib/db/client";
import { adminUsers, sessions } from "@/lib/db/schema";
import { createAdminUser } from "@/lib/repos/admin-users";
import { proxy } from "@/proxy";

describe("proxy (CSRF cookie issuance)", () => {
  it("sets a csrf_token cookie on a request that doesn't have one", async () => {
    const request = new NextRequest(new URL("http://localhost/admin/login"));
    const response = await proxy(request);
    const setCookie = response.cookies.get(CSRF_COOKIE_NAME);
    expect(setCookie?.value).toBeTruthy();
    expect(setCookie?.httpOnly).toBe(true);
    expect(setCookie?.sameSite).toBe("lax");
    expect(setCookie?.path).toBe("/");
  });

  it("leaves an existing csrf_token cookie untouched", async () => {
    const request = new NextRequest(new URL("http://localhost/admin/login"), {
      headers: { cookie: `${CSRF_COOKIE_NAME}=existing-token` },
    });
    const response = await proxy(request);
    // No new Set-Cookie header means the existing browser cookie is kept.
    expect(response.cookies.get(CSRF_COOKIE_NAME)).toBeUndefined();
  });
});

// Route protection (task 4.2): every /admin/** page and /api/admin/**
// route must reject an unauthenticated request. No real page files exist
// under src/app/admin or src/app/api/admin yet (those land in 4.3+), so
// this enumerates the canonical route paths from specs/04-admin.md's
// Screens list rather than walking the filesystem — switch this list to a
// real directory scan (matching tests/unit/ci-config.test.ts's pattern)
// once those directories exist, so a newly added route automatically
// joins the enumeration instead of being forgotten.
const PROTECTED_PAGE_PATHS = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/orders",
  "/admin/orders/some-order-id",
  "/admin/settings",
];
const PROTECTED_API_PATHS = [
  "/api/admin/products",
  "/api/admin/orders/some-order-id",
];

describe("proxy (route protection)", () => {
  let adminUserId: string | undefined;

  afterEach(async () => {
    if (adminUserId) {
      await db.delete(sessions).where(eq(sessions.adminUserId, adminUserId));
      await db.delete(adminUsers).where(eq(adminUsers.id, adminUserId));
      adminUserId = undefined;
    }
  });

  it.each(PROTECTED_PAGE_PATHS)(
    "redirects an unauthenticated request to %s to /admin/login",
    async (path) => {
      const request = new NextRequest(new URL(`http://localhost${path}`));
      const response = await proxy(request);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost/admin/login",
      );
    },
  );

  it.each(PROTECTED_API_PATHS)(
    "responds 401 to an unauthenticated request to %s",
    async (path) => {
      const request = new NextRequest(new URL(`http://localhost${path}`));
      const response = await proxy(request);
      expect(response.status).toBe(401);
    },
  );

  it("does not redirect a request to /admin/login itself", async () => {
    const request = new NextRequest(new URL("http://localhost/admin/login"));
    const response = await proxy(request);
    expect(response.status).toBe(200);
  });

  it("passes through a protected page request with a valid session cookie", async () => {
    const user = await createAdminUser({
      email: `proxy-test-${crypto.randomUUID()}@example.com`,
      passwordHash: "unused",
    });
    adminUserId = user.id;
    const { token } = await issueSession(user.id);

    const request = new NextRequest(
      new URL("http://localhost/admin/products"),
      { headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` } },
    );
    const response = await proxy(request);
    expect(response.status).toBe(200);
  });

  it("redirects a protected page request with an expired session cookie", async () => {
    const user = await createAdminUser({
      email: `proxy-test-${crypto.randomUUID()}@example.com`,
      passwordHash: "unused",
    });
    adminUserId = user.id;
    const { token } = await issueSession(user.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const request = new NextRequest(
      new URL("http://localhost/admin/products"),
      { headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` } },
    );
    const response = await proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/login",
    );
  });
});
