import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));
const sessionCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@/lib/auth/csrf-cookie", () => ({
  readCsrfCookie: vi.fn(async () => csrfCookie.token),
}));

vi.mock("@/lib/auth/session-cookie", () => ({
  readAdminSessionToken: vi.fn(async () => sessionCookie.token),
}));

class TestRedirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new TestRedirect(url);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { CSRF_FIELD_NAME, generateCsrfToken } from "@/lib/auth/csrf-token";
import { db } from "@/lib/db/client";
import {
  auditLog,
  inventoryMovements,
  productVariants,
  products,
} from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant } from "@/lib/repos/variants";
import { emptyStockAdjustmentFormValues } from "@/lib/validation/stock-adjustment-form";

import {
  adjustStockAction,
  type StockAdjustmentFormState,
} from "./admin-inventory";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const initialState: StockAdjustmentFormState = {
  errors: {},
  values: emptyStockAdjustmentFormValues,
};

describe("adjustStockAction", () => {
  const productIds: string[] = [];
  let csrfToken: string;

  beforeEach(() => {
    csrfToken = generateCsrfToken();
    csrfCookie.token = csrfToken;
  });

  afterEach(async () => {
    for (const id of productIds.splice(0)) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id));
      const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id));
      for (const variant of variants) {
        await db
          .delete(inventoryMovements)
          .where(eq(inventoryMovements.variantId, variant.id));
        await db.delete(auditLog).where(eq(auditLog.entityId, variant.id));
      }
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  it("returns a form error and records nothing when the csrf field doesn't match the cookie", async () => {
    const product = await createProduct({
      slug: "test-stock-csrf",
      name: "Test Product",
    });
    productIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "FC-STOCK-CSRF-001",
      name: "Balsam Fir",
      priceCents: 2499,
      weightGrams: 340,
    });

    const result = await adjustStockAction(
      variant.id,
      initialState,
      formData({
        [CSRF_FIELD_NAME]: "wrong-token",
        delta: "5",
        reason: "adjustment",
      }),
    );

    expect(result.formError).toBeTruthy();
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    expect(movements).toHaveLength(0);
  });

  it("returns a per-field error and records nothing when the delta is zero", async () => {
    const product = await createProduct({
      slug: "test-stock-zero-delta",
      name: "Test Product",
    });
    productIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "FC-STOCK-ZERO-001",
      name: "Balsam Fir",
      priceCents: 2499,
      weightGrams: 340,
    });

    const result = await adjustStockAction(
      variant.id,
      initialState,
      formData({
        [CSRF_FIELD_NAME]: csrfToken,
        delta: "0",
        reason: "adjustment",
      }),
    );

    expect(result.errors.delta?.[0]).toBeTruthy();
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    expect(movements).toHaveLength(0);
  });

  it("returns a form error and records nothing for an unknown variant", async () => {
    const result = await adjustStockAction(
      "00000000-0000-0000-0000-000000000000",
      initialState,
      formData({
        [CSRF_FIELD_NAME]: csrfToken,
        delta: "5",
        reason: "adjustment",
      }),
    );

    expect(result.formError).toBeTruthy();
  });

  it("records a movement via recordMovement, writes an audit row, and redirects to the product's edit page", async () => {
    const product = await createProduct({
      slug: "test-stock-record",
      name: "Test Product",
    });
    productIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "FC-STOCK-RECORD-001",
      name: "Balsam Fir",
      priceCents: 2499,
      weightGrams: 340,
    });

    await expect(
      adjustStockAction(
        variant.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          delta: "12",
          reason: "adjustment",
          note: "Recount after restock",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

    const [movement] = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    expect(movement).toBeTruthy();
    expect(movement!.delta).toBe(12);
    expect(movement!.reason).toBe("adjustment");
    expect(movement!.note).toBe("Recount after restock");

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, variant.id));
    expect(entry).toBeTruthy();
    expect(entry!.action).toBe("adjust_stock");
  });

  it("records a negative delta (e.g. damage) correctly", async () => {
    const product = await createProduct({
      slug: "test-stock-negative",
      name: "Test Product",
    });
    productIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: "FC-STOCK-NEG-001",
      name: "Balsam Fir",
      priceCents: 2499,
      weightGrams: 340,
    });

    await expect(
      adjustStockAction(
        variant.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          delta: "-4",
          reason: "damage",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

    const [movement] = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    expect(movement!.delta).toBe(-4);
    expect(movement!.reason).toBe("damage");
    expect(movement!.note).toBeNull();
  });
});
