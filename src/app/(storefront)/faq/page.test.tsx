import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { env } from "@/lib/env";
import FaqPage from "./page";

describe("FaqPage", () => {
  it("renders the heading and no placeholder copy", () => {
    render(<FaqPage />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Frequently Asked Questions",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
  });

  it("answers the processing-time and returns questions", () => {
    render(<FaqPage />);
    expect(
      screen.getByText(/how long does processing take/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/do you accept returns or exchanges/i),
    ).toBeInTheDocument();
  });

  it("links out to the shipping and returns policies", () => {
    render(<FaqPage />);
    expect(
      screen.getByRole("link", { name: "Shipping Policy" }),
    ).toHaveAttribute("href", "/shipping");
    expect(
      screen.getByRole("link", { name: "Returns & Refunds Policy" }),
    ).toHaveAttribute("href", "/returns");
  });

  it("resolves the support contact from ADMIN_EMAIL", () => {
    render(<FaqPage />);
    const links = screen.getAllByRole("link", { name: env.ADMIN_EMAIL! });
    expect(links[0]).toHaveAttribute("href", `mailto:${env.ADMIN_EMAIL}`);
  });

  it("has no axe violations", async () => {
    const { container } = render(<FaqPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
