import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { ImageManager } from "./image-manager";

const defaultProps = {
  csrfToken: "test-token",
  updateAction: vi.fn(),
  uploadAction: vi.fn(),
};

const images = [
  {
    id: "22222222-2222-2222-2222-222222222222",
    url: "https://example.com/a.webp",
    altText: "Balsam fir candle",
    position: 0,
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    url: "https://example.com/b.webp",
    altText: "Candle detail",
    position: 1,
  },
];

describe("ImageManager", () => {
  it("renders an empty state when there are no images yet", () => {
    render(<ImageManager {...defaultProps} images={[]} />);

    expect(screen.getByText(/no images yet/i)).toBeInTheDocument();
  });

  it("renders an alt text and position field per existing image", () => {
    render(<ImageManager {...defaultProps} images={images} />);

    const firstAlt = screen.getByDisplayValue("Balsam fir candle");
    const secondAlt = screen.getByDisplayValue("Candle detail");
    expect(firstAlt).toBeInTheDocument();
    expect(secondAlt).toBeInTheDocument();
  });

  it("always renders the add-image upload form", () => {
    const { container } = render(
      <ImageManager {...defaultProps} images={images} />,
    );

    expect(screen.getByLabelText(/add image/i)).toBeInTheDocument();
    expect(container.querySelector("#new-image-alt-text")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload image/i }),
    ).toBeInTheDocument();
  });

  it("submits the csrf token as a hidden field on both forms", () => {
    const { container } = render(
      <ImageManager {...defaultProps} images={images} />,
    );

    const hiddenFields = container.querySelectorAll('input[type="hidden"]');
    expect(hiddenFields.length).toBeGreaterThanOrEqual(2);
    for (const field of hiddenFields) {
      expect((field as HTMLInputElement).value).toBe("test-token");
    }
  });

  it("has no axe violations with images present", async () => {
    const { container } = render(
      <ImageManager {...defaultProps} images={images} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the empty state", async () => {
    const { container } = render(
      <ImageManager {...defaultProps} images={[]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
