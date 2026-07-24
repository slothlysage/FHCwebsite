import { describe, expect, it } from "vitest";

import {
  altTextFieldName,
  deleteFieldName,
  parseImageUploadForm,
  positionFieldName,
} from "./product-images-form";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("parseImageUploadForm", () => {
  it("accepts a non-empty, trimmed alt text", () => {
    const result = parseImageUploadForm(formData({ altText: "  A candle  " }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.altText).toBe("A candle");
    }
  });

  it("rejects an empty alt text", () => {
    const result = parseImageUploadForm(formData({ altText: "" }));

    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only alt text", () => {
    const result = parseImageUploadForm(formData({ altText: "   " }));

    expect(result.success).toBe(false);
  });
});

describe("field name helpers", () => {
  it("namespace each field by image id, distinct per field kind", () => {
    const id = "22222222-2222-2222-2222-222222222222";

    expect(altTextFieldName(id)).toBe(`altText__${id}`);
    expect(positionFieldName(id)).toBe(`position__${id}`);
    expect(deleteFieldName(id)).toBe(`delete__${id}`);

    const names = new Set([
      altTextFieldName(id),
      positionFieldName(id),
      deleteFieldName(id),
    ]);
    expect(names.size).toBe(3);
  });
});
