import { describe, expect, it } from "vitest";

import {
  emptyVariantFormValues,
  parseVariantForm,
  variantFormFieldErrors,
} from "@/lib/validation/variant-form";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("parseVariantForm", () => {
  it("accepts a minimal valid submission", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        compareAtPriceCents: "",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: 2499,
        compareAtPriceCents: undefined,
        weightGrams: 340,
        isActive: false,
      });
    }
  });

  it("reads isActive from a checkbox-style 'on' value", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        weightGrams: "340",
        isActive: "on",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("rejects a blank SKU", () => {
    const result = parseVariantForm(
      formData({
        sku: "  ",
        name: "Balsam Fir",
        priceCents: "24.99",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(variantFormFieldErrors(result).sku).toContain("SKU is required");
    }
  });

  it("rejects a blank name", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: " ",
        priceCents: "24.99",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(variantFormFieldErrors(result).name).toContain("Name is required");
    }
  });

  it("rejects a non-numeric price", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "free",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(variantFormFieldErrors(result).priceCents).toBeDefined();
    }
  });

  it("rejects a negative price", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "-5",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric weight", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        weightGrams: "heavy",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(variantFormFieldErrors(result).weightGrams).toBeDefined();
    }
  });

  it("accepts a populated compare-at price and converts it to cents", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        compareAtPriceCents: "29.99",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.compareAtPriceCents).toBe(2999);
    }
  });

  it("rejects a non-numeric compare-at price", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        compareAtPriceCents: "expensive",
        weightGrams: "340",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(variantFormFieldErrors(result).compareAtPriceCents).toBeDefined();
    }
  });

  it("returns an empty error object on success", () => {
    const result = parseVariantForm(
      formData({
        sku: "FC-CANDLE-001",
        name: "Balsam Fir",
        priceCents: "24.99",
        weightGrams: "340",
      }),
    );
    expect(variantFormFieldErrors(result)).toEqual({});
  });

  it("exports empty default values for a blank new-variant form", () => {
    expect(emptyVariantFormValues).toEqual({
      sku: "",
      name: "",
      priceCents: "",
      compareAtPriceCents: "",
      weightGrams: "",
      isActive: true,
    });
  });
});
