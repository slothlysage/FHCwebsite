import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Lavender Soap")).toBe("lavender-soap");
  });

  it("collapses runs of non-alphanumeric characters into one hyphen", () => {
    expect(slugify("Body Butter -- 8oz!!")).toBe("body-butter-8oz");
  });

  it("trims leading/trailing hyphens produced by punctuation at the edges", () => {
    expect(slugify("  --Balsam Fir--  ")).toBe("balsam-fir");
  });

  it("keeps existing hyphens and numbers as-is", () => {
    expect(slugify("8oz-candle")).toBe("8oz-candle");
  });
});
