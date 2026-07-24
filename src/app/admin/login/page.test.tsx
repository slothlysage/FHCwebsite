import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

const csrfCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@/lib/auth/csrf-cookie", () => ({
  readCsrfCookie: vi.fn(async () => csrfCookie.token),
}));

import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import AdminLoginPage from "./page";

// An async Server Component, invoked and awaited directly — same pattern as
// products/page.test.tsx and cart/page.test.tsx. Only next/headers' cookies()
// (via the csrf-cookie mock above) is faked, since it requires a real Next
// request to work at all outside a server. loginAction itself is exercised
// end-to-end by admin-auth.test.ts; this file only covers what the page
// renders around it.

async function renderPage(error?: string) {
  return render(
    await AdminLoginPage({ searchParams: Promise.resolve({ error }) }),
  );
}

describe("AdminLoginPage", () => {
  it("renders labeled email and password fields and a submit button", async () => {
    await renderPage();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("embeds the csrf cookie's value in a hidden field", async () => {
    csrfCookie.token = "the-csrf-token";
    const { container } = await renderPage();
    const hidden = container.querySelector(
      `input[type="hidden"][name="${CSRF_FIELD_NAME}"]`,
    );
    expect(hidden).toHaveAttribute("value", "the-csrf-token");
  });

  it("renders no error alert when there is no error query param", async () => {
    await renderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a generic incorrect-credentials message for invalid_credentials, without saying which of email/password was wrong", async () => {
    await renderPage("invalid_credentials");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Incorrect email or password.");
    expect(alert.textContent).not.toMatch(/no such user|unknown email/i);
  });

  it("shows a locked-account message for locked", async () => {
    await renderPage("locked");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /too many failed attempts/i,
    );
  });

  it("shows a generic try-again message for csrf_mismatch", async () => {
    await renderPage("csrf_mismatch");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /please try logging in again/i,
    );
  });

  it("falls back to the generic message for an unrecognized error value", async () => {
    await renderPage("something_unexpected");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderPage("locked");
    expect(await axe(container)).toHaveNoViolations();
  });
});
