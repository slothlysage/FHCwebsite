import { describe, expect, it } from "vitest";

import { planVariantSync } from "@/lib/services/stripe-sync";

describe("planVariantSync", () => {
  it("skips an inactive variant even with no stripePriceId", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: false, stripePriceId: null },
      null,
    );
    expect(plan).toEqual({ action: "skip" });
  });

  it("skips an inactive variant even when a current Stripe price is in sync", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: false, stripePriceId: "price_1" },
      { unitAmount: 1999, active: true },
    );
    expect(plan).toEqual({ action: "skip" });
  });

  it("creates for an active variant with no stripePriceId yet", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: true, stripePriceId: null },
      null,
    );
    expect(plan).toEqual({ action: "create" });
  });

  it("creates when stripePriceId is set but the Stripe price can't be found", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: true, stripePriceId: "price_1" },
      null,
    );
    expect(plan).toEqual({ action: "create" });
  });

  it("is a noop when the current Stripe price matches local price and is active", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: true, stripePriceId: "price_1" },
      { unitAmount: 1999, active: true },
    );
    expect(plan).toEqual({ action: "noop" });
  });

  it("replaces when the local price changed since the last sync", () => {
    const plan = planVariantSync(
      { priceCents: 2499, isActive: true, stripePriceId: "price_1" },
      { unitAmount: 1999, active: true },
    );
    expect(plan).toEqual({ action: "replace" });
  });

  it("replaces when the known Stripe price is archived, even at the same amount", () => {
    const plan = planVariantSync(
      { priceCents: 1999, isActive: true, stripePriceId: "price_1" },
      { unitAmount: 1999, active: false },
    );
    expect(plan).toEqual({ action: "replace" });
  });
});
