import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { VariantList } from "./variant-list";

describe("VariantList", () => {
  it("renders each variant's SKU, name, price, compare-at price, weight, and active state", () => {
    render(
      <VariantList
        variants={[
          {
            id: "22222222-2222-2222-2222-222222222222",
            sku: "FC-CANDLE-001",
            name: "Balsam Fir",
            priceCents: 2499,
            compareAtPriceCents: 2999,
            weightGrams: 340,
            isActive: true,
          },
        ]}
        csrfToken="test-token"
        createAction={vi.fn()}
        updateAction={() => vi.fn()}
      />,
    );

    expect(screen.getByText("FC-CANDLE-001")).toBeInTheDocument();
    expect(screen.getByText("Balsam Fir")).toBeInTheDocument();
    expect(screen.getByText("$24.99")).toBeInTheDocument();
    expect(screen.getByText("$29.99")).toBeInTheDocument();
    expect(screen.getByText("340g")).toBeInTheDocument();
    expect(screen.getByText("Status: Active")).toBeInTheDocument();
  });

  it("renders an empty state when there are no variants yet", () => {
    render(
      <VariantList
        variants={[]}
        csrfToken="test-token"
        createAction={vi.fn()}
        updateAction={() => vi.fn()}
      />,
    );

    expect(screen.getByText(/no variants yet/i)).toBeInTheDocument();
  });

  it("labels an inactive variant", () => {
    render(
      <VariantList
        variants={[
          {
            id: "22222222-2222-2222-2222-222222222222",
            sku: "FC-CANDLE-002",
            name: "Cedarwood",
            priceCents: 2000,
            compareAtPriceCents: null,
            weightGrams: 300,
            isActive: false,
          },
        ]}
        csrfToken="test-token"
        createAction={vi.fn()}
        updateAction={() => vi.fn()}
      />,
    );

    expect(screen.getByText("Status: Inactive")).toBeInTheDocument();
  });

  it("includes an expandable edit form and an add-variant form", () => {
    render(
      <VariantList
        variants={[
          {
            id: "22222222-2222-2222-2222-222222222222",
            sku: "FC-CANDLE-001",
            name: "Balsam Fir",
            priceCents: 2499,
            compareAtPriceCents: null,
            weightGrams: 340,
            isActive: true,
          },
        ]}
        csrfToken="test-token"
        createAction={vi.fn()}
        updateAction={() => vi.fn()}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Edit FC-CANDLE-001" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add variant" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VariantList
        variants={[
          {
            id: "22222222-2222-2222-2222-222222222222",
            sku: "FC-CANDLE-001",
            name: "Balsam Fir",
            priceCents: 2499,
            compareAtPriceCents: 2999,
            weightGrams: 340,
            isActive: true,
          },
        ]}
        csrfToken="test-token"
        createAction={vi.fn()}
        updateAction={() => vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
