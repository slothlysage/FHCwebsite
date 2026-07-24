import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import type { StockAdjustmentFormState } from "@/lib/actions/admin-inventory";
import { emptyStockAdjustmentFormValues } from "@/lib/validation/stock-adjustment-form";

import { StockAdjustmentForm } from "./stock-adjustment-form";

const initialState: StockAdjustmentFormState = {
  errors: {},
  values: emptyStockAdjustmentFormValues,
};

describe("StockAdjustmentForm", () => {
  it("renders delta, reason, and note fields plus a submit button", () => {
    render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="test-token"
      />,
    );

    expect(screen.getByLabelText(/adjust stock by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record adjustment/i }),
    ).toBeInTheDocument();
  });

  it("offers only the manual-adjustment reasons, not sale/import/refund", () => {
    render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="test-token"
      />,
    );

    const select = screen.getByLabelText(/reason/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("adjustment");
    expect(optionValues).toContain("damage");
    expect(optionValues).not.toContain("sale");
    expect(optionValues).not.toContain("import");
    expect(optionValues).not.toContain("refund");
  });

  it("shows a per-field error for delta", () => {
    render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={{
          errors: { delta: ["Enter a non-zero amount"] },
          values: emptyStockAdjustmentFormValues,
        }}
        csrfToken="test-token"
      />,
    );

    expect(screen.getByText("Enter a non-zero amount")).toBeInTheDocument();
  });

  it("shows a form-level error", () => {
    render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={{
          errors: {},
          values: emptyStockAdjustmentFormValues,
          formError: "Your session expired.",
        }}
        csrfToken="test-token"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session expired.",
    );
  });

  it("submits the csrf token as a hidden field", () => {
    const { container } = render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="the-real-token"
      />,
    );

    const hidden = container.querySelector(
      'input[type="hidden"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("the-real-token");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="test-token"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a field error shown", async () => {
    const { container } = render(
      <StockAdjustmentForm
        action={vi.fn()}
        initialState={{
          errors: { reason: ["Select a reason"] },
          values: emptyStockAdjustmentFormValues,
        }}
        csrfToken="test-token"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
