import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { VariantFormState } from "@/lib/actions/admin-variants";
import { emptyVariantFormValues } from "@/lib/validation/variant-form";

import { VariantForm } from "./variant-form";

const initialState: VariantFormState = {
  errors: {},
  values: emptyVariantFormValues,
};

describe("VariantForm", () => {
  it("renders every field, labeled, seeded from initialState.values", () => {
    render(
      <VariantForm
        action={vi.fn()}
        initialState={{
          errors: {},
          values: {
            sku: "FC-CANDLE-001",
            name: "Balsam Fir",
            priceCents: "24.99",
            compareAtPriceCents: "29.99",
            weightGrams: "340",
            isActive: true,
          },
        }}
        csrfToken="test-token"
        submitLabel="Add variant"
      />,
    );

    expect(screen.getByLabelText("SKU")).toHaveValue("FC-CANDLE-001");
    expect(screen.getByLabelText("Name")).toHaveValue("Balsam Fir");
    expect(screen.getByLabelText("Price")).toHaveValue("24.99");
    expect(screen.getByLabelText("Compare-at price")).toHaveValue("29.99");
    expect(screen.getByLabelText("Weight (grams)")).toHaveValue("340");
    expect(screen.getByLabelText("Active")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Add variant" }),
    ).toBeInTheDocument();
  });

  it("renders a per-field error message after the action returns one", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<VariantFormState> => ({
      errors: { sku: ["SKU is required"] },
      values: { ...initialState.values, sku: "" },
    }));

    render(
      <VariantForm
        action={action}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Add variant"
      />,
    );

    // The SKU field has `required`, which only checks for a non-empty
    // string client-side — a whitespace-only value passes that check and
    // reaches the (mocked) server action, matching ProductForm's own test
    // precedent for its required Name field.
    await user.type(screen.getByLabelText("SKU"), "   ");
    await user.type(screen.getByLabelText("Name"), "Balsam Fir");
    await user.type(screen.getByLabelText("Price"), "24.99");
    await user.type(screen.getByLabelText("Weight (grams)"), "340");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    const skuField = await screen.findByLabelText("SKU");
    expect(await screen.findByText("SKU is required")).toBeInTheDocument();
    expect(skuField).toHaveAttribute("aria-invalid", "true");
  });

  it("renders a form-level error after a csrf mismatch", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<VariantFormState> => ({
      errors: {},
      values: initialState.values,
      formError: "Your session expired.",
    }));

    render(
      <VariantForm
        action={action}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Add variant"
      />,
    );

    await user.type(screen.getByLabelText("SKU"), "FC-CANDLE-001");
    await user.type(screen.getByLabelText("Name"), "Balsam Fir");
    await user.type(screen.getByLabelText("Price"), "24.99");
    await user.type(screen.getByLabelText("Weight (grams)"), "340");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired.",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VariantForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Add variant"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
