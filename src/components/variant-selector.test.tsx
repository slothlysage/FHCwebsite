import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// addToCartAction is a "use server" Server Action (lib/actions/cart.ts) — it
// isn't invokable at all outside a real Next request, so unit tests for this
// client component mock it the same way they'd mock any other network
// boundary and assert only that the form/button wiring is correct, not that
// the action's own business logic runs (that's lib/actions/cart.test.ts's
// and lib/services/cart.test.ts's job, both against the real dev database).
vi.mock("@/lib/actions/cart", () => ({ addToCartAction: vi.fn() }));

import { VariantSelector } from "./variant-selector";
import type { ProductDetailVariant } from "@/lib/services/product-detail";

const variants: ProductDetailVariant[] = [
  {
    id: "1",
    sku: "sku-a",
    name: "8oz",
    priceCents: 2400,
    compareAtPriceCents: null,
    weightGrams: 227,
    stock: 5,
    allowBackorder: true,
  },
  {
    id: "2",
    sku: "sku-b",
    name: "16oz",
    priceCents: 4000,
    compareAtPriceCents: null,
    weightGrams: 454,
    stock: 0,
    allowBackorder: false,
  },
  {
    id: "3",
    sku: "sku-c",
    name: "32oz",
    priceCents: 6000,
    compareAtPriceCents: null,
    weightGrams: 908,
    stock: 0,
    allowBackorder: true,
  },
];

describe("VariantSelector", () => {
  it("shows the initial variant's price and stock state", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByText("$24.00")).toBeInTheDocument();
    expect(screen.getByText(/in stock/i)).toBeInTheDocument();
  });

  it("shows out of stock for a zero-stock variant that disallows backorders", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-b"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it("shows made to order for a zero-stock variant that allows backorders", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-c"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.getByText(/made to order/i)).toBeInTheDocument();
    expect(screen.queryByText(/out of stock/i)).not.toBeInTheDocument();
  });

  it("updates price, stock, and the URL when a different variant is selected, without a full reload", async () => {
    const user = userEvent.setup();
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    await user.selectOptions(screen.getByLabelText(/variant/i), "sku-b");

    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
    expect(window.location.search).toContain("variant=sku-b");
  });

  it("is a GET form to the product's own page, so it still works with JS disabled", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    const form = screen
      .getByRole("button", { name: /update/i })
      .closest("form");
    expect(form).toHaveAttribute("method", "GET");
    expect(form).toHaveAttribute("action", "/products/lavender-candle");
  });

  it("enables add-to-cart for an in-stock variant", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByRole("button", { name: /add to cart/i })).toBeEnabled();
  });

  it("enables add-to-cart for a zero-stock, made-to-order variant", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-c"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByRole("button", { name: /add to cart/i })).toBeEnabled();
  });

  it("disables add-to-cart for a zero-stock variant with no backorder", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-b"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByRole("button", { name: /add to cart/i })).toBeDisabled();
  });

  it("submits the selected variant's id to the add-to-cart action", async () => {
    const { addToCartAction } = await import("@/lib/actions/cart");
    const user = userEvent.setup();
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    await user.click(screen.getByRole("button", { name: /add to cart/i }));

    expect(addToCartAction).toHaveBeenCalledTimes(1);
    const submittedFormData = vi.mocked(addToCartAction).mock
      .calls[0]![0] as FormData;
    expect(submittedFormData.get("variantId")).toBe("1");
  });

  it("renders an unavailable message when a product has no active variants", () => {
    render(
      <VariantSelector
        variants={[]}
        initialSku=""
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
