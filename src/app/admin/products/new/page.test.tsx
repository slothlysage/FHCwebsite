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
import NewProductPage from "./page";

// An async Server Component, invoked and awaited directly — same pattern as
// admin/products/page.test.tsx and admin/login/page.test.tsx. The actual
// create logic is covered end-to-end by admin-products.test.ts; this file
// only covers what the page renders around ProductForm.

describe("NewProductPage", () => {
  it("renders every field blank and labeled", async () => {
    render(await NewProductPage());

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Slug")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Create product" }),
    ).toBeInTheDocument();
  });

  it("embeds the csrf cookie's value in a hidden field", async () => {
    csrfCookie.token = "the-csrf-token";
    const { container } = render(await NewProductPage());
    const hidden = container.querySelector(
      `input[type="hidden"][name="${CSRF_FIELD_NAME}"]`,
    );
    expect(hidden).toHaveAttribute("value", "the-csrf-token");
  });

  it("has no axe violations", async () => {
    const { container } = render(await NewProductPage());
    expect(await axe(container)).toHaveNoViolations();
  });
});
