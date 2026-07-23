import { describe, expect, it } from "vitest";

import { formatPriceCents, truncateForMeta } from "@/lib/format";

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

describe("truncateForMeta", () => {
  it("returns null for null input", () => {
    expect(truncateForMeta(null)).toBeNull();
  });

  it("returns short text unchanged", () => {
    expect(truncateForMeta("A calming candle.")).toBe("A calming candle.");
  });

  it("truncates long text to the limit and adds an ellipsis on a word boundary", () => {
    const long = "A ".repeat(100) + "candle.";
    const result = truncateForMeta(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(160);
    expect(result!.endsWith("…")).toBe(true);
  });

  it("collapses newlines into spaces before truncating", () => {
    expect(truncateForMeta("Line one.\nLine two.")).toBe("Line one. Line two.");
  });
});
