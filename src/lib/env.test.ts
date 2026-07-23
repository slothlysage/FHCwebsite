import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/fhc",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  RESEND_API_KEY: "re_123",
  RESEND_FROM_EMAIL: "orders@example.com",
};

const ORIGINAL_ENV = { ...process.env };

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("parses successfully when all required vars are present", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { env } = await import("./env");
    expect(env.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
    expect(env.NEXT_PUBLIC_SITE_URL).toBe(REQUIRED_ENV.NEXT_PUBLIC_SITE_URL);
    expect(env.ALLOW_LIVE).toBe(false);
  });

  it("throws a readable error naming the missing variable", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.DATABASE_URL;

    await expect(import("./env")).rejects.toThrow(/DATABASE_URL/);
  });

  it("throws a readable error naming a missing public variable", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.NEXT_PUBLIC_SITE_URL;

    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("throws a readable error naming a missing RESEND_API_KEY", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.RESEND_API_KEY;

    await expect(import("./env")).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("coerces ALLOW_LIVE=true", async () => {
    Object.assign(process.env, REQUIRED_ENV, { ALLOW_LIVE: "true" });
    const { env } = await import("./env");
    expect(env.ALLOW_LIVE).toBe(true);
  });

  it("clientEnv exposes only NEXT_PUBLIC_* vars, not server secrets", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { clientEnv } = await import("./env");
    expect((clientEnv as Record<string, unknown>).DATABASE_URL).toBeUndefined();
    expect(clientEnv.NEXT_PUBLIC_SITE_URL).toBe(
      REQUIRED_ENV.NEXT_PUBLIC_SITE_URL,
    );
  });
});
