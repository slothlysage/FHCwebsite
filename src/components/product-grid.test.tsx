import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { ProductGrid } from "./product-grid";
import type { ProductListingItem } from "@/lib/services/product-listing";

function makeItem(
  overrides: Partial<ProductListingItem> = {},
): ProductListingItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "lavender-candle",
    name: "Lavender Candle",
    image: null,
    priceFromCents: 2400,
    inStock: true,
    ...overrides,
  };
}

describe("ProductGrid", () => {
  it("renders one link per product", () => {
    render(
      <ProductGrid
        products={[
          makeItem({ id: "1", slug: "a", name: "Product A" }),
          makeItem({ id: "2", slug: "b", name: "Product B" }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /product a/i })).toHaveAttribute(
      "href",
      "/products/a",
    );
    expect(screen.getByRole("link", { name: /product b/i })).toHaveAttribute(
      "href",
      "/products/b",
    );
  });

  it("shows an empty state with no products when the list is empty", () => {
    render(<ProductGrid products={[]} />);
    expect(screen.getByText(/no products/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("has no axe violations with products", async () => {
    const { container } = render(<ProductGrid products={[makeItem()]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations when empty", async () => {
    const { container } = render(<ProductGrid products={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
