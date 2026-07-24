import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";

import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { createOrder, updateOrder } from "@/lib/repos/orders";
import type { RawSearchParams } from "@/lib/validation/admin-order-filters";
import AdminOrdersPage from "./page";

// Integration test against the real dev database (specs/06-testing.md) — an
// async Server Component, invoked and awaited directly, same pattern as
// admin/products/page.test.tsx.

function withSearchParams(searchParams: RawSearchParams = {}) {
  return AdminOrdersPage({ searchParams: Promise.resolve(searchParams) });
}

function baseOrder(stripeSessionId: string, email: string) {
  return {
    email,
    subtotalCents: 2000,
    shippingCents: 500,
    taxCents: 150,
    totalCents: 2650,
    stripeSessionId,
  };
}

describe("AdminOrdersPage", () => {
  const insertedOrderIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedOrderIds.splice(0)) {
      await db.delete(orders).where(eq(orders.id, id));
    }
  });

  it("renders a labeled search field and status filter", async () => {
    render(await withSearchParams());

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("lists a matching order's number, email, status, and total", async () => {
    const marker = randomUUID();
    const email = `admin-orders-page-${marker}@example.com`;
    const order = await createOrder(
      baseOrder(`cs_test_${randomUUID()}`, email),
      [],
    );
    insertedOrderIds.push(order.id);

    render(await withSearchParams({ search: marker }));

    expect(screen.getByText(email)).toBeInTheDocument();
    expect(screen.getByText(String(order.orderNumber))).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "pending" })).toBeInTheDocument();
    expect(screen.getByText("$26.50")).toBeInTheDocument();
  });

  it("excludes orders that don't match the search term", async () => {
    const marker = randomUUID();
    const email = `admin-orders-page-nonmatch-${marker}@example.com`;
    const order = await createOrder(
      baseOrder(`cs_test_${randomUUID()}`, email),
      [],
    );
    insertedOrderIds.push(order.id);

    render(await withSearchParams({ search: randomUUID() }));

    expect(screen.queryByText(email)).not.toBeInTheDocument();
  });

  it("filters by status", async () => {
    const marker = randomUUID();
    const email = `admin-orders-page-status-${marker}@example.com`;
    const order = await createOrder(
      baseOrder(`cs_test_${randomUUID()}`, email),
      [],
    );
    insertedOrderIds.push(order.id);

    render(await withSearchParams({ search: marker, status: "paid" }));

    expect(screen.queryByText(email)).not.toBeInTheDocument();

    await updateOrder(order.id, { status: "paid", paidAt: new Date() });

    render(await withSearchParams({ search: marker, status: "paid" }));

    expect(screen.getByText(email)).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    render(await withSearchParams({ search: randomUUID() }));

    expect(screen.getByText(/no orders/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(await withSearchParams());
    expect(await axe(container)).toHaveNoViolations();
  });
});
