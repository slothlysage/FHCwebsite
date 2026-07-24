import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen, within } from "@testing-library/react";

import { VariantList } from "./variant-list";

const defaultProps = {
  csrfToken: "test-token",
  createAction: vi.fn(),
  updateAction: () => vi.fn(),
  adjustStockAction: () => vi.fn(),
  stockByVariantId: new Map<string, number>(),
};

describe("VariantList", () => {
  it("renders each variant's SKU, name, price, compare-at price, weight, and active state", () => {
    render(
      <VariantList
        {...defaultProps}
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
    render(<VariantList {...defaultProps} variants={[]} />);

    expect(screen.getByText(/no variants yet/i)).toBeInTheDocument();
  });

  it("labels an inactive variant", () => {
    render(
      <VariantList
        {...defaultProps}
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
      />,
    );

    expect(screen.getByText("Status: Inactive")).toBeInTheDocument();
  });

  it("includes an expandable edit form and an add-variant form", () => {
    render(
      <VariantList
        {...defaultProps}
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
      />,
    );

    expect(
      screen.getByRole("group", { name: "Edit FC-CANDLE-001" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add variant" }),
    ).toBeInTheDocument();
  });

  it("renders the current stock from the batch lookup, not an editable field", () => {
    render(
      <VariantList
        {...defaultProps}
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
        stockByVariantId={
          new Map([["22222222-2222-2222-2222-222222222222", 7]])
        }
      />,
    );

    expect(screen.getByText("Stock: 7")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stock")).not.toBeInTheDocument();
  });

  it("shows stock as 0 when the variant has no entry in the batch lookup", () => {
    render(
      <VariantList
        {...defaultProps}
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
      />,
    );

    expect(screen.getByText("Stock: 0")).toBeInTheDocument();
  });

  it("includes the stock-adjustment form inside the edit disclosure", () => {
    render(
      <VariantList
        {...defaultProps}
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
      />,
    );

    const group = screen.getByRole("group", { name: "Edit FC-CANDLE-001" });
    expect(
      within(group).getByRole("button", { name: /record adjustment/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VariantList
        {...defaultProps}
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
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
