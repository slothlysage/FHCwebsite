import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { env } from "@/lib/env";
import TermsPage from "./page";

describe("TermsPage", () => {
  it("renders the heading and no placeholder copy", () => {
    render(<TermsPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of Service" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/insert email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shopify/i)).not.toBeInTheDocument();
  });

  it("links to the returns and privacy policies", () => {
    render(<TermsPage />);
    expect(
      screen.getAllByRole("link", { name: /returns & refunds policy/i })[0],
    ).toHaveAttribute("href", "/returns");
    expect(
      screen.getByRole("link", { name: /privacy policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("resolves the support contact from ADMIN_EMAIL", () => {
    render(<TermsPage />);
    const links = screen.getAllByRole("link", { name: env.ADMIN_EMAIL! });
    expect(links[0]).toHaveAttribute("href", `mailto:${env.ADMIN_EMAIL}`);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TermsPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
