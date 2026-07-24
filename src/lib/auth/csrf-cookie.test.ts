import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  })),
}));

import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";

describe("readCsrfCookie", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it("returns undefined when no csrf_token cookie is set", async () => {
    expect(await readCsrfCookie()).toBeUndefined();
  });

  it("returns the cookie's value when one is set", async () => {
    cookieStore.set(CSRF_COOKIE_NAME, "the-token");
    expect(await readCsrfCookie()).toBe("the-token");
  });
});
