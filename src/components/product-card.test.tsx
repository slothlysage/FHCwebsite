import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { ProductCard } from "./product-card";
import type { ProductListingItem } from "@/lib/services/product-listing";

function makeItem(
  overrides: Partial<ProductListingItem> = {},
): ProductListingItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "lavender-candle",
    name: "Lavender Candle",
    image: {
      url: "https://example.com/lavender.jpg",
      altText: "Lavender candle",
    },
    priceFromCents: 2400,
    inStock: true,
    ...overrides,
  };
}

describe("ProductCard", () => {
  it("links to the product detail page by slug", () => {
    render(<ProductCard product={makeItem()} />);
    expect(
      screen.getByRole("link", { name: /lavender candle/i }),
    ).toHaveAttribute("href", "/products/lavender-candle");
  });

  it("renders the product image with its alt text", () => {
    render(<ProductCard product={makeItem()} />);
    expect(
      screen.getByRole("img", { name: "Lavender candle" }),
    ).toHaveAttribute("src", "https://example.com/lavender.jpg");
  });

  it("renders a placeholder when there is no image", () => {
    render(<ProductCard product={makeItem({ image: null })} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/no image/i)).toBeInTheDocument();
  });

  it("renders the price-from as formatted currency", () => {
    render(<ProductCard product={makeItem({ priceFromCents: 2400 })} />);
    expect(screen.getByText("From $24.00")).toBeInTheDocument();
  });

  it("shows no price when the product has no active variants", () => {
    render(<ProductCard product={makeItem({ priceFromCents: null })} />);
    expect(screen.queryByText(/from \$/i)).not.toBeInTheDocument();
  });

  it("shows an out-of-stock label when the product is out of stock", () => {
    render(<ProductCard product={makeItem({ inStock: false })} />);
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it("does not show an out-of-stock label when in stock", () => {
    render(<ProductCard product={makeItem({ inStock: true })} />);
    expect(screen.queryByText(/out of stock/i)).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ul>
        <ProductCard product={makeItem()} />
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
