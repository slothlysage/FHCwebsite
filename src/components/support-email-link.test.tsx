import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/support-contact", () => ({
  getSupportEmail: vi.fn(),
}));

describe("SupportEmailLink", () => {
  it("renders a mailto link when a support email is configured", async () => {
    const { getSupportEmail } = await import("@/lib/support-contact");
    vi.mocked(getSupportEmail).mockReturnValue("hello@example.com");
    const { SupportEmailLink } = await import("./support-email-link");

    render(<SupportEmailLink />);
    expect(
      screen.getByRole("link", { name: "hello@example.com" }),
    ).toHaveAttribute("href", "mailto:hello@example.com");
  });

  it("falls back to plain text when no support email is configured", async () => {
    const { getSupportEmail } = await import("@/lib/support-contact");
    vi.mocked(getSupportEmail).mockReturnValue(null);
    const { SupportEmailLink } = await import("./support-email-link");

    render(<SupportEmailLink />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("our support team")).toBeInTheDocument();
  });
});
