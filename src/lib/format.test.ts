import { describe, expect, it } from "vitest";

import { formatPriceCents } from "@/lib/format";

describe("formatPriceCents", () => {
  it("formats whole dollars", () => {
    expect(formatPriceCents(2000)).toBe("$20.00");
  });

  it("formats cents with rounding to two decimal places", () => {
    expect(formatPriceCents(1999)).toBe("$19.99");
  });

  it("formats zero", () => {
    expect(formatPriceCents(0)).toBe("$0.00");
  });
});
