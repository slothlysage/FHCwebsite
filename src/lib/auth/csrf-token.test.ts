import { describe, expect, it } from "vitest";

import { generateCsrfToken } from "@/lib/auth/csrf-token";

describe("generateCsrfToken", () => {
  it("returns a base64url string with no padding/unsafe characters", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes -> 43 base64url characters (no padding).
    expect(token.length).toBe(43);
  });

  it("returns a different token on each call", () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});
