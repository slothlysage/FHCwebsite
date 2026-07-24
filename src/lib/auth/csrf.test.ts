import { describe, expect, it } from "vitest";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { generateCsrfToken } from "@/lib/auth/csrf-token";

describe("csrfTokensMatch", () => {
  it("returns true for two equal, non-empty tokens", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("returns false for two different tokens of the same length", () => {
    const a = "a".repeat(43);
    const b = "b".repeat(43);
    expect(csrfTokensMatch(a, b)).toBe(false);
  });

  it("returns false for tokens of different lengths", () => {
    expect(csrfTokensMatch("short", "a much longer token value")).toBe(false);
  });

  it("returns false when the submitted token is undefined", () => {
    expect(csrfTokensMatch(undefined, generateCsrfToken())).toBe(false);
  });

  it("returns false when the cookie token is undefined", () => {
    expect(csrfTokensMatch(generateCsrfToken(), undefined)).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(csrfTokensMatch(undefined, undefined)).toBe(false);
  });

  it("returns false when either is an empty string", () => {
    expect(csrfTokensMatch("", generateCsrfToken())).toBe(false);
    expect(csrfTokensMatch(generateCsrfToken(), "")).toBe(false);
  });
});
