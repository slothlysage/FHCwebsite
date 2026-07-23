import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { ProductGallery } from "./product-gallery";

describe("ProductGallery", () => {
  it("renders every image with its alt text", () => {
    render(
      <ProductGallery
        images={[
          { url: "https://example.com/a.jpg", altText: "Front view" },
          { url: "https://example.com/b.jpg", altText: "Side view" },
        ]}
        productName="Lavender Candle"
      />,
    );

    expect(screen.getByAltText("Front view")).toBeInTheDocument();
    expect(screen.getByAltText("Side view")).toBeInTheDocument();
  });

  it("shows a placeholder when a product has no images", () => {
    render(<ProductGallery images={[]} productName="Lavender Candle" />);

    expect(screen.getByText(/no image/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ProductGallery
        images={[{ url: "https://example.com/a.jpg", altText: "Front view" }]}
        productName="Lavender Candle"
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
