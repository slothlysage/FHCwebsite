import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { ProductPagination } from "./product-pagination";
import { parseProductFilters } from "@/lib/validation/product-filters";

describe("ProductPagination", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <ProductPagination
        filters={parseProductFilters({})}
        hasNextPage={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a Next link (but no Previous) on page 1 when there are more results", () => {
    render(
      <ProductPagination
        filters={parseProductFilters({})}
        hasNextPage={true}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /previous/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/products?page=2",
    );
  });

  it("shows a Previous link (but no Next) on the last page", () => {
    render(
      <ProductPagination
        filters={parseProductFilters({ page: "2" })}
        hasNextPage={false}
      />,
    );

    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(
      screen.queryByRole("link", { name: /next/i }),
    ).not.toBeInTheDocument();
  });

  it("shows both links on a middle page and preserves active filters in both hrefs", () => {
    render(
      <ProductPagination
        filters={parseProductFilters({ page: "2", category: "candles" })}
        hasNextPage={true}
      />,
    );

    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/products?category=candles",
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/products?category=candles&page=3",
    );
  });

  it("announces the current page for assistive tech", () => {
    render(
      <ProductPagination
        filters={parseProductFilters({ page: "2" })}
        hasNextPage={true}
      />,
    );
    expect(screen.getByText(/page 2/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ProductPagination
        filters={parseProductFilters({ page: "2" })}
        hasNextPage={true}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
