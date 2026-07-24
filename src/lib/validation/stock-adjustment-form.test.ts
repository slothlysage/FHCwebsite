import { describe, expect, it } from "vitest";

import {
  emptyStockAdjustmentFormValues,
  parseStockAdjustmentForm,
  stockAdjustmentFormFieldErrors,
} from "./stock-adjustment-form";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("parseStockAdjustmentForm", () => {
  it("accepts a positive delta with a valid reason", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "5", reason: "adjustment", note: "Recount" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        delta: 5,
        reason: "adjustment",
        note: "Recount",
      });
    }
  });

  it("accepts a negative delta", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "-3", reason: "damage" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delta).toBe(-3);
    }
  });

  it("rejects a zero delta", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "0", reason: "adjustment" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric delta", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "abc", reason: "adjustment" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a fractional delta", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "1.5", reason: "adjustment" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const result = parseStockAdjustmentForm(formData({ delta: "5" }));
    expect(result.success).toBe(false);
  });

  it("rejects a reason outside the manual-adjustment set (e.g. sale)", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "5", reason: "sale" }),
    );
    expect(result.success).toBe(false);
  });

  it("treats a blank note as absent, not an empty string", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "5", reason: "adjustment", note: "   " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
    }
  });

  it("omits note entirely without error", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "5", reason: "damage" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("stockAdjustmentFormFieldErrors", () => {
  it("returns an empty object on success", () => {
    const result = parseStockAdjustmentForm(
      formData({ delta: "5", reason: "adjustment" }),
    );
    expect(stockAdjustmentFormFieldErrors(result)).toEqual({});
  });

  it("returns per-field errors on failure", () => {
    const result = parseStockAdjustmentForm(formData({ delta: "0" }));
    const errors = stockAdjustmentFormFieldErrors(result);
    expect(errors.delta?.[0]).toBeTruthy();
    expect(errors.reason?.[0]).toBeTruthy();
  });
});

describe("emptyStockAdjustmentFormValues", () => {
  it("is blank for every field", () => {
    expect(emptyStockAdjustmentFormValues).toEqual({
      delta: "",
      reason: "",
      note: "",
    });
  });
});
