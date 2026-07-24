import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProductFormState } from "@/lib/actions/admin-products";

import { ProductForm } from "./product-form";

const initialState: ProductFormState = {
  errors: {},
  values: {
    name: "",
    slug: "",
    description: "",
    ingredients: "",
    safetyInfo: "",
    careInfo: "",
  },
};

describe("ProductForm", () => {
  it("renders every field, labeled, seeded from initialState.values", () => {
    render(
      <ProductForm
        action={vi.fn()}
        initialState={{
          errors: {},
          values: {
            name: "Balsam Candle",
            slug: "balsam-candle",
            description: "Woodsy.",
            ingredients: "Soy wax, fragrance.",
            safetyInfo: "Do not leave unattended.",
            careInfo: "Trim wick before each burn.",
          },
        }}
        csrfToken="test-token"
        submitLabel="Create product"
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Balsam Candle");
    expect(screen.getByLabelText("Slug")).toHaveValue("balsam-candle");
    expect(screen.getByLabelText("Description")).toHaveValue("Woodsy.");
    expect(screen.getByLabelText("Ingredients")).toHaveValue(
      "Soy wax, fragrance.",
    );
    expect(screen.getByLabelText("Safety info")).toHaveValue(
      "Do not leave unattended.",
    );
    expect(screen.getByLabelText("Care info")).toHaveValue(
      "Trim wick before each burn.",
    );
    expect(
      screen.getByRole("button", { name: "Create product" }),
    ).toBeInTheDocument();
  });

  it("renders a per-field error message after the action returns one", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<ProductFormState> => ({
      errors: { name: ["Name is required"] },
      values: { ...initialState.values, name: "" },
    }));

    render(
      <ProductForm
        action={action}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Create product"
      />,
    );

    // The Name field has `required`, which only checks for a non-empty
    // string client-side — a whitespace-only value passes that check (same
    // as a real browser would allow) and lets this test reach the server
    // action, which is what actually rejects it (product-form.ts trims
    // before validating).
    await user.type(screen.getByLabelText("Name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    const nameField = await screen.findByLabelText("Name");
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(nameField).toHaveAttribute("aria-invalid", "true");
  });

  it("renders a form-level error after a csrf mismatch", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<ProductFormState> => ({
      errors: {},
      values: initialState.values,
      formError: "Your session expired.",
    }));

    render(
      <ProductForm
        action={action}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Create product"
      />,
    );

    // Required so the native/jsdom constraint check lets the submit through
    // to the (mocked) action at all — irrelevant to what's under test here.
    await user.type(screen.getByLabelText("Name"), "Balsam Candle");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired.",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ProductForm
        action={vi.fn()}
        initialState={initialState}
        csrfToken="test-token"
        submitLabel="Create product"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
