import { describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MutationState } from "@/lib/actions/admin-products";

import { ProductStatusActions } from "./product-status-actions";

const noop = vi.fn(async (): Promise<MutationState> => ({}));

describe("ProductStatusActions", () => {
  it("shows a Publish button and no Unpublish button for a draft product", () => {
    render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="draft"
        csrfToken="test-token"
        publishAction={noop}
        unpublishAction={noop}
        deleteAction={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unpublish" }),
    ).not.toBeInTheDocument();
  });

  it("shows an Unpublish button and no Publish button for a published product", () => {
    render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="published"
        csrfToken="test-token"
        publishAction={noop}
        unpublishAction={noop}
        deleteAction={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Unpublish" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish" }),
    ).not.toBeInTheDocument();
  });

  it("renders the publish-gate failure message returned by publishAction", async () => {
    const user = userEvent.setup();
    const publishAction = vi.fn(async (): Promise<MutationState> => ({
      formError: "Cannot publish yet — fill in ingredients.",
    }));

    render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="draft"
        csrfToken="test-token"
        publishAction={publishAction}
        unpublishAction={noop}
        deleteAction={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(
      await screen.findByText("Cannot publish yet — fill in ingredients."),
    ).toBeInTheDocument();
  });

  it("does not submit the delete form when the confirmation dialog is dismissed", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const deleteAction = vi.fn(async (): Promise<MutationState> => ({}));

    render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="draft"
        csrfToken="test-token"
        publishAction={noop}
        unpublishAction={noop}
        deleteAction={deleteAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete product" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete "Balsam Candle"? This cannot be undone.',
    );
    expect(deleteAction).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("submits the delete form when the confirmation dialog is accepted", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteAction = vi.fn(async (): Promise<MutationState> => ({}));

    render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="draft"
        csrfToken="test-token"
        publishAction={noop}
        unpublishAction={noop}
        deleteAction={deleteAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete product" }));

    expect(deleteAction).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ProductStatusActions
        productName="Balsam Candle"
        status="draft"
        csrfToken="test-token"
        publishAction={noop}
        unpublishAction={noop}
        deleteAction={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
