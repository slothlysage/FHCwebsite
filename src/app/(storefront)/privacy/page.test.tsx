import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { env } from "@/lib/env";
import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  it("renders the heading and no placeholder copy", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
  });

  it("describes real data practices: guest checkout, Stripe, the cart cookie", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/placed as a guest/i)).toBeInTheDocument();
    expect(screen.getByText(/handled entirely by Stripe/i)).toBeInTheDocument();
    expect(screen.getByText(/one functional cookie/i)).toBeInTheDocument();
  });

  it("resolves the support contact from ADMIN_EMAIL", () => {
    render(<PrivacyPage />);
    const links = screen.getAllByRole("link", { name: env.ADMIN_EMAIL! });
    expect(links[0]).toHaveAttribute("href", `mailto:${env.ADMIN_EMAIL}`);
  });

  it("has no axe violations", async () => {
    const { container } = render(<PrivacyPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
