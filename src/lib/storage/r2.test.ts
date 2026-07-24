import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getR2FakeObject,
  r2Server,
  resetR2FakeState,
} from "../../../tests/msw/r2-server";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/fhc",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  RESEND_API_KEY: "re_123",
  RESEND_FROM_EMAIL: "orders@example.com",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://assets.example.com",
};

const ORIGINAL_ENV = { ...process.env };

// Imported dynamically, after per-test env is set, so each test's module
// instance re-reads a fresh `@/lib/env` — same pattern as
// src/lib/stripe/client.test.ts.
async function importR2() {
  return import("./r2");
}

beforeAll(() => r2Server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  r2Server.resetHandlers();
  resetR2FakeState();
});
afterAll(() => r2Server.close());

describe("r2 storage client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("misconfiguration", () => {
    it.each([
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "R2_PUBLIC_URL",
    ])("fails loud when %s is missing", async (missingVar) => {
      delete process.env[missingVar];
      const { getPresignedUploadUrl } = await importR2();

      await expect(
        getPresignedUploadUrl("products/abc/thumb.webp", "image/webp"),
      ).rejects.toThrow(new RegExp(missingVar));
    });

    it("publicUrlForKey throws synchronously when misconfigured", async () => {
      delete process.env.R2_PUBLIC_URL;
      const { publicUrlForKey } = await importR2();

      expect(() => publicUrlForKey("products/abc/thumb.webp")).toThrow(
        /R2_PUBLIC_URL/,
      );
    });
  });

  describe("getPresignedUploadUrl", () => {
    it("returns a SigV4 query-signed PUT URL scoped to the bucket and key", async () => {
      const { getPresignedUploadUrl } = await importR2();

      const url = await getPresignedUploadUrl(
        "products/abc/thumb.webp",
        "image/webp",
      );
      const parsed = new URL(url);

      expect(parsed.hostname).toBe("test-account.r2.cloudflarestorage.com");
      expect(parsed.pathname).toBe("/test-bucket/products/abc/thumb.webp");
      expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe(
        "AWS4-HMAC-SHA256",
      );
      expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
      expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    });

    it("honors a custom expiry", async () => {
      const { getPresignedUploadUrl } = await importR2();

      const url = await getPresignedUploadUrl(
        "products/abc/thumb.webp",
        "image/webp",
        60,
      );

      expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("60");
    });
  });

  describe("putObject / getObject", () => {
    it("round-trips bytes through the mocked R2 endpoint", async () => {
      const { putObject, getObject } = await importR2();
      const body = new TextEncoder().encode("hello r2");

      await putObject("products/abc/thumb.webp", body, "image/webp");
      const fetched = await getObject("products/abc/thumb.webp");

      expect(new TextDecoder().decode(fetched)).toBe("hello r2");
      expect(getR2FakeObject("products/abc/thumb.webp")?.contentType).toBe(
        "image/webp",
      );
    });

    it("throws a readable error when getObject targets a missing key", async () => {
      const { getObject } = await importR2();

      await expect(getObject("does/not/exist.webp")).rejects.toThrow(
        /does\/not\/exist\.webp/,
      );
    });

    it("throws a readable error when putObject's request fails", async () => {
      const { putObject } = await importR2();
      const { http, HttpResponse } = await import("msw");
      r2Server.use(
        http.put(
          /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\//,
          () => new HttpResponse("Forbidden", { status: 403 }),
        ),
      );
      const failingBody = new TextEncoder().encode("boom");

      await expect(
        putObject("products/abc/thumb.webp", failingBody, "image/webp"),
      ).rejects.toThrow(/403/);
    });
  });

  describe("publicUrlForKey", () => {
    it("builds a public URL under R2_PUBLIC_URL", async () => {
      const { publicUrlForKey } = await importR2();

      expect(publicUrlForKey("products/abc/thumb.webp")).toBe(
        "https://assets.example.com/products/abc/thumb.webp",
      );
    });

    it("strips a trailing slash from R2_PUBLIC_URL before joining", async () => {
      process.env.R2_PUBLIC_URL = "https://assets.example.com/";
      const { publicUrlForKey } = await importR2();

      expect(publicUrlForKey("products/abc/thumb.webp")).toBe(
        "https://assets.example.com/products/abc/thumb.webp",
      );
    });
  });
});
