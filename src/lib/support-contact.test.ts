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

describe("getSupportEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns ADMIN_EMAIL when it's configured", async () => {
    process.env.ADMIN_EMAIL = "owner@example.com";
    const { getSupportEmail } = await import("./support-contact");
    expect(getSupportEmail()).toBe("owner@example.com");
  });

  it("returns null when ADMIN_EMAIL isn't configured", async () => {
    delete process.env.ADMIN_EMAIL;
    const { getSupportEmail } = await import("./support-contact");
    expect(getSupportEmail()).toBeNull();
  });
});
