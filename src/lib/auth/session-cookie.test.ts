import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

import {
  ADMIN_SESSION_COOKIE_NAME,
  clearAdminSessionToken,
  readAdminSessionToken,
  writeAdminSessionToken,
} from "@/lib/auth/session-cookie";

describe("admin session cookie", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it("returns undefined when no admin_session cookie is set", async () => {
    expect(await readAdminSessionToken()).toBeUndefined();
  });

  it("writes the token so a subsequent read returns it", async () => {
    await writeAdminSessionToken("a-session-token");
    expect(await readAdminSessionToken()).toBe("a-session-token");
  });

  it("clears the token so a subsequent read returns undefined", async () => {
    cookieStore.set(ADMIN_SESSION_COOKIE_NAME, "a-session-token");
    await clearAdminSessionToken();
    expect(await readAdminSessionToken()).toBeUndefined();
  });
});
