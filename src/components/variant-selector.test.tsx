import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("renders an accessibly-disabled add-to-cart button (cart lands in 2.7)", () => {
    render(
      <VariantSelector
        variants={variants}
        initialSku="sku-a"
        productSlug="lavender-candle"
      />,
    );

    expect(screen.getByRole("button", { name: /add to cart/i })).toBeDisabled();
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
