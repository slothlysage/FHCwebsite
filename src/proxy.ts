import { NextResponse, type NextRequest } from "next/server";

import { CSRF_COOKIE_NAME, generateCsrfToken } from "@/lib/auth/csrf-token";
import { verifySession } from "@/lib/auth/session";
import { ADMIN_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

// Ensures every admin-area request has a CSRF cookie to double-submit
// against (specs/04-admin.md's Auth section, task 4.1c) — issuing it here,
// not in a Server Action, is what lets the *first* page render (before any
// form has ever been submitted) already have a token to embed in a hidden
// field.
//
// Also guards /admin/** and /api/admin/** (task 4.2): an invalid/missing
// session redirects page requests to /admin/login and 401s API requests.
// /admin/login itself is exempt from the check (else login could never be
// reached) but still gets a CSRF cookie like every other admin request.
// This file runs unconditionally on Node.js runtime — Next.js 16 renamed
// middleware.ts to proxy.ts and, per the framework itself (a real `next
// build` confirms: "Proxy always runs on Node.js runtime"), no longer lets
// a route-segment `runtime` config opt into the old Edge Runtime here — so
// the node:crypto/pg calls inside verifySession are safe to reach from
// this file, unlike the Edge-Runtime-only csrf-token.ts import below.
const ADMIN_LOGIN_PATH = "/admin/login";

function isAdminPagePath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isAdminApiPath(pathname: string): boolean {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const needsAuth =
    (isAdminPagePath(pathname) && pathname !== ADMIN_LOGIN_PATH) ||
    isAdminApiPath(pathname);

  if (needsAuth) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const result = token ? await verifySession(token) : undefined;
    if (!result?.valid) {
      if (isAdminApiPath(pathname)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL(ADMIN_LOGIN_PATH, request.url));
    }
  }

  if (request.cookies.has(CSRF_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
