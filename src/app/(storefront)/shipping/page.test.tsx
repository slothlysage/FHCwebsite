import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { env } from "@/lib/env";
import ShippingPage from "./page";

describe("ShippingPage", () => {
  it("renders the heading and no placeholder copy", () => {
    render(<ShippingPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Shipping Policy" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/insert.*address/i)).not.toBeInTheDocument();
  });

  it("states processing time and carriers", () => {
    render(<ShippingPage />);
    expect(screen.getByText(/3–7 business days/i)).toBeInTheDocument();
    expect(screen.getByText(/USPS, FedEx, or DHL/i)).toBeInTheDocument();
  });

  it("resolves the support contact from ADMIN_EMAIL", () => {
    render(<ShippingPage />);
    const link = screen.getByRole("link", { name: env.ADMIN_EMAIL! });
    expect(link).toHaveAttribute("href", `mailto:${env.ADMIN_EMAIL}`);
  });

  it("has no axe violations", async () => {
    const { container } = render(<ShippingPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
