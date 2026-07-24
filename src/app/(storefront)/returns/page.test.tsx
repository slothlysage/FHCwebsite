import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { env } from "@/lib/env";
import ReturnsPage from "./page";

describe("ReturnsPage", () => {
  it("renders the heading and no placeholder copy", () => {
    render(<ReturnsPage />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Returns & Refunds Policy",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/insert.*address/i)).not.toBeInTheDocument();
  });

  it("states the all-sales-final policy and the melted body butter guidance", () => {
    render(<ReturnsPage />);
    expect(screen.getAllByText(/all sales are final/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/body butter arrives melted/i)).toBeInTheDocument();
  });

  it("resolves the support contact from ADMIN_EMAIL", () => {
    render(<ReturnsPage />);
    const links = screen.getAllByRole("link", { name: env.ADMIN_EMAIL! });
    expect(links[0]).toHaveAttribute("href", `mailto:${env.ADMIN_EMAIL}`);
  });

  it("has no axe violations", async () => {
    const { container } = render(<ReturnsPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
