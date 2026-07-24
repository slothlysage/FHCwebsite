import { describe, expect, it } from "vitest";

import {
  parseProductForm,
  productFormFieldErrors,
} from "@/lib/validation/product-form";

function formData(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe("parseProductForm", () => {
  it("accepts a minimal valid submission (name only)", () => {
    const result = parseProductForm(formData({ name: "Lavender Soap" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Lavender Soap",
        slug: undefined,
        description: undefined,
        ingredients: undefined,
        safetyInfo: undefined,
        careInfo: undefined,
      });
    }
  });

  it("trims the name and rejects a blank one", () => {
    const blank = parseProductForm(formData({ name: "   " }));
    expect(blank.success).toBe(false);

    const trimmed = parseProductForm(formData({ name: "  Lavender Soap  " }));
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.name).toBe("Lavender Soap");
  });

  it("reports a missing name as a field error, not a thrown exception", () => {
    const result = parseProductForm(formData({}));
    expect(result.success).toBe(false);
    expect(productFormFieldErrors(result).name).toBeDefined();
  });

  it("accepts a well-formed manual slug override", () => {
    const result = parseProductForm(
      formData({ name: "Lavender Soap", slug: "lavender-soap-8oz" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBe("lavender-soap-8oz");
  });

  it("rejects a manual slug with spaces or uppercase letters", () => {
    const withSpace = parseProductForm(
      formData({ name: "Lavender Soap", slug: "lavender soap" }),
    );
    expect(withSpace.success).toBe(false);

    const upper = parseProductForm(
      formData({ name: "Lavender Soap", slug: "Lavender-Soap" }),
    );
    expect(upper.success).toBe(false);
  });

  it("treats a blank slug as absent (auto-generate), not a format error", () => {
    const result = parseProductForm(
      formData({ name: "Lavender Soap", slug: "   " }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBeUndefined();
  });

  it("treats blank optional text fields as absent", () => {
    const result = parseProductForm(
      formData({
        name: "Lavender Soap",
        description: "  ",
        ingredients: "",
        safetyInfo: "  ",
        careInfo: "",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.ingredients).toBeUndefined();
      expect(result.data.safetyInfo).toBeUndefined();
      expect(result.data.careInfo).toBeUndefined();
    }
  });

  it("keeps and trims populated optional text fields", () => {
    const result = parseProductForm(
      formData({
        name: "Lavender Soap",
        description: "  A calming bar.  ",
        ingredients: "Saponified oils, lavender essential oil",
        safetyInfo: "Keep away from eyes.",
        careInfo: "Store in a cool, dry place.",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("A calming bar.");
      expect(result.data.ingredients).toBe(
        "Saponified oils, lavender essential oil",
      );
      expect(result.data.safetyInfo).toBe("Keep away from eyes.");
      expect(result.data.careInfo).toBe("Store in a cool, dry place.");
    }
  });
});

describe("productFormFieldErrors", () => {
  it("returns an empty object for a successful parse", () => {
    const result = parseProductForm(formData({ name: "Lavender Soap" }));
    expect(productFormFieldErrors(result)).toEqual({});
  });

  it("maps each invalid field to its own error messages", () => {
    const result = parseProductForm(formData({ name: "", slug: "Not A Slug" }));
    const errors = productFormFieldErrors(result);
    expect(errors.name).toBeDefined();
    expect(errors.slug).toBeDefined();
  });
});
