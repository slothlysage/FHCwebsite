import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/fhc",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

const ORIGINAL_ENV = { ...process.env };

describe("stripe client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("initializes normally with a test-mode secret key", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { stripe } = await import("./client");
    expect(stripe).toBeDefined();
  });

  it("refuses to initialize with a live secret key when ALLOW_LIVE is unset", async () => {
    Object.assign(process.env, REQUIRED_ENV, {
      STRIPE_SECRET_KEY: "sk_live_abc123",
    });

    await expect(import("./client")).rejects.toThrow(/ALLOW_LIVE/);
  });

  it("refuses to initialize with a live secret key when ALLOW_LIVE=false", async () => {
    Object.assign(process.env, REQUIRED_ENV, {
      STRIPE_SECRET_KEY: "sk_live_abc123",
      ALLOW_LIVE: "false",
    });

    await expect(import("./client")).rejects.toThrow(/ALLOW_LIVE/);
  });

  it("initializes with a live secret key when ALLOW_LIVE=true", async () => {
    Object.assign(process.env, REQUIRED_ENV, {
      STRIPE_SECRET_KEY: "sk_live_abc123",
      ALLOW_LIVE: "true",
    });

    const { stripe } = await import("./client");
    expect(stripe).toBeDefined();
  });

  it("pins the API version rather than floating to the account default", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { STRIPE_API_VERSION } = await import("./client");
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
