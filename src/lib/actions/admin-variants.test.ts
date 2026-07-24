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
import { auditLog, productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant, getVariantById } from "@/lib/repos/variants";
import { emptyVariantFormValues } from "@/lib/validation/variant-form";

import {
  createVariantAction,
  updateVariantAction,
  type VariantFormState,
} from "./admin-variants";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const initialState: VariantFormState = {
  errors: {},
  values: emptyVariantFormValues,
};

describe("admin variant actions", () => {
  const productIds: string[] = [];
  let csrfToken: string;

  beforeEach(() => {
    csrfToken = generateCsrfToken();
    csrfCookie.token = csrfToken;
  });

  afterEach(async () => {
    for (const id of productIds.splice(0)) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id));
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  describe("createVariantAction", () => {
    it("returns a form error and creates nothing when the csrf field doesn't match the cookie", async () => {
      const product = await createProduct({
        slug: "test-variant-csrf",
        name: "Test Product",
      });
      productIds.push(product.id);

      const result = await createVariantAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: "wrong-token",
          sku: "FC-TEST-001",
          name: "Balsam Fir",
          priceCents: "24.99",
          weightGrams: "340",
        }),
      );

      expect(result.formError).toBeTruthy();
      const rows = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, product.id));
      expect(rows).toHaveLength(0);
    });

    it("returns a per-field error and creates nothing when sku is blank", async () => {
      const product = await createProduct({
        slug: "test-variant-blank-sku",
        name: "Test Product",
      });
      productIds.push(product.id);

      const result = await createVariantAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          sku: "  ",
          name: "Balsam Fir",
          priceCents: "24.99",
          weightGrams: "340",
        }),
      );

      expect(result.errors.sku?.[0]).toBeTruthy();
    });

    it("creates a variant and redirects to the product's edit page", async () => {
      const product = await createProduct({
        slug: "test-variant-create",
        name: "Test Product",
      });
      productIds.push(product.id);

      await expect(
        createVariantAction(
          product.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            sku: "FC-TEST-CREATE-001",
            name: "Balsam Fir",
            priceCents: "24.99",
            weightGrams: "340",
            isActive: "on",
          }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const [created] = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.sku, "FC-TEST-CREATE-001"));
      expect(created).toBeTruthy();
      expect(created!.priceCents).toBe(2499);
      expect(created!.weightGrams).toBe(340);
      expect(created!.isActive).toBe(true);

      const [entry] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, created!.id));
      expect(entry).toBeTruthy();
      expect(entry!.action).toBe("create_variant");
    });

    it("returns a field error and creates nothing when the SKU is already in use", async () => {
      const product = await createProduct({
        slug: "test-variant-sku-collision",
        name: "Test Product",
      });
      productIds.push(product.id);
      await createVariant({
        productId: product.id,
        sku: "FC-TEST-TAKEN-001",
        name: "Existing",
        priceCents: 1000,
        weightGrams: 100,
      });

      const result = await createVariantAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          sku: "FC-TEST-TAKEN-001",
          name: "New Variant",
          priceCents: "24.99",
          weightGrams: "340",
        }),
      );

      expect(result.errors.sku?.[0]).toBeTruthy();
      const rows = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.sku, "FC-TEST-TAKEN-001"));
      expect(rows).toHaveLength(1);
    });
  });

  describe("updateVariantAction", () => {
    it("returns a form error and updates nothing when the csrf field doesn't match the cookie", async () => {
      const product = await createProduct({
        slug: "test-variant-update-csrf",
        name: "Test Product",
      });
      productIds.push(product.id);
      const variant = await createVariant({
        productId: product.id,
        sku: "FC-TEST-UPDATE-CSRF-001",
        name: "Original",
        priceCents: 1000,
        weightGrams: 100,
      });

      const result = await updateVariantAction(
        variant.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: "wrong-token",
          sku: variant.sku,
          name: "New Name",
          priceCents: "24.99",
          weightGrams: "340",
        }),
      );

      expect(result.formError).toBeTruthy();
      const unchanged = await getVariantById(variant.id);
      expect(unchanged!.name).toBe("Original");
    });

    it("updates a variant's fields and redirects to the product's edit page", async () => {
      const product = await createProduct({
        slug: "test-variant-update",
        name: "Test Product",
      });
      productIds.push(product.id);
      const variant = await createVariant({
        productId: product.id,
        sku: "FC-TEST-UPDATE-001",
        name: "Original",
        priceCents: 1000,
        weightGrams: 100,
        isActive: true,
      });

      await expect(
        updateVariantAction(
          variant.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            sku: "FC-TEST-UPDATE-001",
            name: "Updated Name",
            priceCents: "19.99",
            compareAtPriceCents: "22.99",
            weightGrams: "200",
          }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const updated = await getVariantById(variant.id);
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.priceCents).toBe(1999);
      expect(updated!.compareAtPriceCents).toBe(2299);
      expect(updated!.weightGrams).toBe(200);
      expect(updated!.isActive).toBe(false);

      const [entry] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, variant.id));
      expect(entry).toBeTruthy();
      expect(entry!.action).toBe("update_variant");
    });

    it("does not self-collide when the sku is unchanged", async () => {
      const product = await createProduct({
        slug: "test-variant-self-sku",
        name: "Test Product",
      });
      productIds.push(product.id);
      const variant = await createVariant({
        productId: product.id,
        sku: "FC-TEST-SELF-001",
        name: "Original",
        priceCents: 1000,
        weightGrams: 100,
      });

      await expect(
        updateVariantAction(
          variant.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            sku: "FC-TEST-SELF-001",
            name: "Renamed",
            priceCents: "24.99",
            weightGrams: "340",
          }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const updated = await getVariantById(variant.id);
      expect(updated!.name).toBe("Renamed");
    });

    it("returns a field error when the sku collides with a different variant", async () => {
      const product = await createProduct({
        slug: "test-variant-update-collision",
        name: "Test Product",
      });
      productIds.push(product.id);
      await createVariant({
        productId: product.id,
        sku: "FC-TEST-OTHER-001",
        name: "Other",
        priceCents: 1000,
        weightGrams: 100,
      });
      const variant = await createVariant({
        productId: product.id,
        sku: "FC-TEST-MINE-001",
        name: "Mine",
        priceCents: 1000,
        weightGrams: 100,
      });

      const result = await updateVariantAction(
        variant.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          sku: "FC-TEST-OTHER-001",
          name: "Mine",
          priceCents: "24.99",
          weightGrams: "340",
        }),
      );

      expect(result.errors.sku?.[0]).toBeTruthy();
      const unchanged = await getVariantById(variant.id);
      expect(unchanged!.sku).toBe("FC-TEST-MINE-001");
    });
  });
});
