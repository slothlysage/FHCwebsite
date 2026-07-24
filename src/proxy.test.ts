import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";
import { proxy } from "@/proxy";

describe("proxy (CSRF cookie issuance)", () => {
  it("sets a csrf_token cookie on a request that doesn't have one", () => {
    const request = new NextRequest(new URL("http://localhost/admin/login"));
    const response = proxy(request);
    const setCookie = response.cookies.get(CSRF_COOKIE_NAME);
    expect(setCookie?.value).toBeTruthy();
    expect(setCookie?.httpOnly).toBe(true);
    expect(setCookie?.sameSite).toBe("lax");
    expect(setCookie?.path).toBe("/");
  });

  it("leaves an existing csrf_token cookie untouched", () => {
    const request = new NextRequest(new URL("http://localhost/admin/login"), {
      headers: { cookie: `${CSRF_COOKIE_NAME}=existing-token` },
    });
    const response = proxy(request);
    // No new Set-Cookie header means the existing browser cookie is kept.
    expect(response.cookies.get(CSRF_COOKIE_NAME)).toBeUndefined();
  });
});
