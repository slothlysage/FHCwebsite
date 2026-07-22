import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "./site-footer";

const POLICY_LINKS: Array<[string, string]> = [
  ["About", "/about"],
  ["Contact", "/contact"],
  ["FAQ", "/faq"],
  ["Shipping", "/shipping"],
  ["Returns", "/returns"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
];

describe("SiteFooter", () => {
  it("renders every policy link", () => {
    render(<SiteFooter />);
    for (const [name, href] of POLICY_LINKS) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("renders the policy links inside a labeled navigation landmark", () => {
    render(<SiteFooter />);
    expect(
      screen.getByRole("navigation", { name: "Policies" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SiteFooter />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
