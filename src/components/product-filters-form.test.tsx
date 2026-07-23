import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductFiltersForm } from "@/components/product-filters-form";
import type { FilterFacets } from "@/lib/services/product-listing";
import { parseProductFilters } from "@/lib/validation/product-filters";

const facets: FilterFacets = {
  categories: [
    { slug: "candles", name: "Candles" },
    { slug: "soap", name: "Soap" },
  ],
  scents: ["lavender", "vanilla"],
  sizes: ["4oz", "8oz"],
};

describe("ProductFiltersForm", () => {
  it("submits as a plain GET form to /products (works without JS)", () => {
    render(
      <ProductFiltersForm filters={parseProductFilters({})} facets={facets} />,
    );
    const form = document.querySelector("form");
    expect(form).toHaveAttribute("method", "GET");
    expect(form).toHaveAttribute("action", "/products");
  });

  it("renders a checkbox per facet option, checked to match current filters", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({ category: "candles", scent: "vanilla" })}
        facets={facets}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Candles" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Soap" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "vanilla" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "lavender" }),
    ).not.toBeChecked();
  });

  it("pre-fills min/max price and the in-stock checkbox from current filters", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({
          minPrice: "10",
          maxPrice: "30",
          inStock: "true",
        })}
        facets={facets}
      />,
    );

    expect(screen.getByLabelText("Min")).toHaveValue(10);
    expect(screen.getByLabelText("Max")).toHaveValue(30);
    expect(
      screen.getByRole("checkbox", { name: "In stock only" }),
    ).toBeChecked();
  });

  it("pre-selects the current sort in the sort dropdown", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({ sort: "price_desc" })}
        facets={facets}
      />,
    );
    expect(screen.getByLabelText(/sort by/i)).toHaveValue("price_desc");
  });

  it("shows no active-filter chips when nothing is selected", () => {
    render(
      <ProductFiltersForm filters={parseProductFilters({})} facets={facets} />,
    );
    expect(
      screen.queryByRole("list", { name: /active filters/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a removable chip per active facet value plus a clear-all link", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({
          category: "candles",
          inStock: "true",
        })}
        facets={facets}
      />,
    );

    const candlesChip = screen.getByRole("link", { name: /candles/i });
    expect(candlesChip.getAttribute("href")).not.toContain("category=candles");
    // Removing the in-stock chip should drop only inStock, keeping category.
    expect(
      screen.getByRole("link", { name: /in stock only/i }),
    ).toHaveAttribute("href", "/products?category=candles");
    expect(screen.getByRole("link", { name: /clear all/i })).toHaveAttribute(
      "href",
      "/products",
    );
  });

  it("renders a removable chip for an active scent or size filter", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({ scent: "lavender", size: "8oz" })}
        facets={facets}
      />,
    );

    expect(
      screen.getByRole("link", { name: /scent: lavender/i }),
    ).not.toHaveAttribute("href", expect.stringContaining("scent=lavender"));
    expect(
      screen.getByRole("link", { name: /size: 8oz/i }),
    ).not.toHaveAttribute("href", expect.stringContaining("size=8oz"));
  });

  it("labels a price chip with 'any' for whichever bound is unset", () => {
    render(
      <ProductFiltersForm
        filters={parseProductFilters({ minPrice: "10" })}
        facets={facets}
      />,
    );
    expect(screen.getByText("Price: $10 – any")).toBeInTheDocument();
  });

  it("has no axe violations with filters active", async () => {
    const { container } = render(
      <ProductFiltersForm
        filters={parseProductFilters({ category: "candles", inStock: "true" })}
        facets={facets}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with no filters active", async () => {
    const { container } = render(
      <ProductFiltersForm filters={parseProductFilters({})} facets={facets} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
