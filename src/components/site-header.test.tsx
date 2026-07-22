import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("renders the site name linking home", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "FHC" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders primary navigation as a landmark", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute(
      "href",
      "/products",
    );
  });

  it("renders a cart indicator with an accessible item count", () => {
    render(<SiteHeader />);
    expect(
      screen.getByRole("link", { name: /cart, 0 items/i }),
    ).toHaveAttribute("href", "/cart");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SiteHeader />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
