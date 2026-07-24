import { NextResponse, type NextRequest } from "next/server";

import { CSRF_COOKIE_NAME, generateCsrfToken } from "@/lib/auth/csrf-token";

// Ensures every admin-area request has a CSRF cookie to double-submit
// against (specs/04-admin.md's Auth section, task 4.1c) — issuing it here,
// not in a Server Action, is what lets the *first* page render (before any
// form has ever been submitted) already have a token to embed in a hidden
// field. Auth/session route-guarding for /admin/** is task 4.2's job and
// belongs in this same file (Next.js only runs one proxy.ts — the renamed,
// current-convention successor to middleware.ts, deprecated as of this
// Next.js version) — extend this function, don't add a second one.
export function proxy(request: NextRequest): NextResponse {
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
