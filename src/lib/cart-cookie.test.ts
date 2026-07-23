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
  })),
}));

import { CART_COOKIE_NAME, readCartId, writeCartId } from "@/lib/cart-cookie";

describe("cart-cookie", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it("returns undefined when no cart_id cookie is set", async () => {
    expect(await readCartId()).toBeUndefined();
  });

  it("returns the cookie's value when one is set", async () => {
    cookieStore.set(CART_COOKIE_NAME, "abc-123");
    expect(await readCartId()).toBe("abc-123");
  });

  it("writes the cart id so a subsequent read returns it", async () => {
    await writeCartId("new-cart-id");
    expect(await readCartId()).toBe("new-cart-id");
  });
});
