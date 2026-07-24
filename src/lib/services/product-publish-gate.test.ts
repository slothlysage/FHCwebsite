import { describe, expect, it } from "vitest";

import { checkPublishGate } from "@/lib/services/product-publish-gate";

// Pure logic (specs/04-admin.md's Screens section): "Publish is blocked
// unless: at least one image with alt text, at least one active variant
// with a price, and non-empty ingredients and safety info." No DB needed —
// see catalog-importer.test.ts for the same "pure service, unit tested
// directly" precedent.

const okProduct = {
  ingredients: "Shea butter, cocoa butter.",
  safetyInfo: "Keep away from heat.",
};
const okImage = { altText: "A jar of body butter on a wooden table" };
const okVariant = { isActive: true, priceCents: 1999 };

describe("checkPublishGate", () => {
  it("passes when every requirement is met", () => {
    const result = checkPublishGate({
      product: okProduct,
      images: [okImage],
      variants: [okVariant],
    });

    expect(result).toEqual({ ok: true });
  });

  it("fails when there are no images", () => {
    const result = checkPublishGate({
      product: okProduct,
      images: [],
      variants: [okVariant],
    });

    expect(result).toEqual({
      ok: false,
      failures: ["no_image_with_alt_text"],
    });
  });

  it("fails when every image has blank alt text", () => {
    const result = checkPublishGate({
      product: okProduct,
      images: [{ altText: "  " }],
      variants: [okVariant],
    });

    expect(result).toEqual({
      ok: false,
      failures: ["no_image_with_alt_text"],
    });
  });

  it("fails when there is no active variant", () => {
    const result = checkPublishGate({
      product: okProduct,
      images: [okImage],
      variants: [{ isActive: false, priceCents: 1999 }],
    });

    expect(result).toEqual({
      ok: false,
      failures: ["no_active_priced_variant"],
    });
  });

  it("fails when every active variant has a zero price", () => {
    const result = checkPublishGate({
      product: okProduct,
      images: [okImage],
      variants: [{ isActive: true, priceCents: 0 }],
    });

    expect(result).toEqual({
      ok: false,
      failures: ["no_active_priced_variant"],
    });
  });

  it("fails when ingredients is null", () => {
    const result = checkPublishGate({
      product: { ...okProduct, ingredients: null },
      images: [okImage],
      variants: [okVariant],
    });

    expect(result).toEqual({ ok: false, failures: ["missing_ingredients"] });
  });

  it("fails when ingredients is blank", () => {
    const result = checkPublishGate({
      product: { ...okProduct, ingredients: "   " },
      images: [okImage],
      variants: [okVariant],
    });

    expect(result).toEqual({ ok: false, failures: ["missing_ingredients"] });
  });

  it("fails when safetyInfo is null", () => {
    const result = checkPublishGate({
      product: { ...okProduct, safetyInfo: null },
      images: [okImage],
      variants: [okVariant],
    });

    expect(result).toEqual({ ok: false, failures: ["missing_safety_info"] });
  });

  it("reports every failing requirement at once", () => {
    const result = checkPublishGate({
      product: { ingredients: null, safetyInfo: null },
      images: [],
      variants: [],
    });

    expect(result).toEqual({
      ok: false,
      failures: [
        "no_image_with_alt_text",
        "no_active_priced_variant",
        "missing_ingredients",
        "missing_safety_info",
      ],
    });
  });
});
