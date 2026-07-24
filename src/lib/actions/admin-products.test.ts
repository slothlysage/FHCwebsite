import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfCookie = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@/lib/auth/csrf-cookie", () => ({
  readCsrfCookie: vi.fn(async () => csrfCookie.token),
}));

// Same TestRedirect pattern as admin-auth.test.ts/cart.test.ts: redirect()'s
// real type is `(url: string) => never` (it throws to unwind the action), so
// the mock must throw too, or a success-path assertion would silently fall
// through into whatever comes after the redirect() call.
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
import { products } from "@/lib/db/schema";
import { createProduct, getProductById } from "@/lib/repos/products";

import { emptyProductFormValues } from "@/lib/validation/product-form";

import {
  createProductAction,
  updateProductAction,
  type ProductFormState,
} from "./admin-products";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const initialState: ProductFormState = {
  errors: {},
  values: emptyProductFormValues,
};

describe("admin product actions", () => {
  const insertedIds: string[] = [];
  let csrfToken: string;

  beforeEach(() => {
    csrfToken = generateCsrfToken();
    csrfCookie.token = csrfToken;
  });

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(products).where(eq(products.id, id));
    }
  });

  describe("createProductAction", () => {
    it("returns a form error and preserves submitted values when the csrf field doesn't match the cookie", async () => {
      const result = await createProductAction(
        initialState,
        formData({
          [CSRF_FIELD_NAME]: "wrong-token",
          name: "Balsam Candle",
        }),
      );

      expect(result.formError).toBeTruthy();
      expect(result.values.name).toBe("Balsam Candle");
      expect(result.errors).toEqual({});
    });

    it("returns a per-field error and creates nothing when name is blank", async () => {
      const result = await createProductAction(
        initialState,
        formData({ [CSRF_FIELD_NAME]: csrfToken, name: "  " }),
      );

      expect(result.errors.name?.[0]).toBeTruthy();
    });

    it("creates a product with an auto-generated slug and redirects to the products list", async () => {
      await expect(
        createProductAction(
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            name: "Test Create Action Candle",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/admin/products");

      const [created] = await db
        .select()
        .from(products)
        .where(eq(products.slug, "test-create-action-candle"));
      expect(created).toBeTruthy();
      insertedIds.push(created!.id);
      expect(created!.status).toBe("draft");
    });

    it("de-duplicates the slug against an existing product", async () => {
      const existing = await createProduct({
        slug: "test-create-action-collision",
        name: "Existing",
      });
      insertedIds.push(existing.id);

      await expect(
        createProductAction(
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            name: "Whatever",
            slug: "test-create-action-collision",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/admin/products");

      const [created] = await db
        .select()
        .from(products)
        .where(eq(products.slug, "test-create-action-collision-2"));
      expect(created).toBeTruthy();
      insertedIds.push(created!.id);
    });
  });

  describe("updateProductAction", () => {
    it("returns a form error and updates nothing when the csrf field doesn't match the cookie", async () => {
      const existing = await createProduct({
        slug: "test-update-action-csrf",
        name: "Original Name",
      });
      insertedIds.push(existing.id);

      const result = await updateProductAction(
        existing.id,
        initialState,
        formData({ [CSRF_FIELD_NAME]: "wrong-token", name: "New Name" }),
      );

      expect(result.formError).toBeTruthy();
      const unchanged = await getProductById(existing.id);
      expect(unchanged?.name).toBe("Original Name");
    });

    it("returns a per-field error and updates nothing when name is blank", async () => {
      const existing = await createProduct({
        slug: "test-update-action-blank-name",
        name: "Original Name",
      });
      insertedIds.push(existing.id);

      const result = await updateProductAction(
        existing.id,
        initialState,
        formData({ [CSRF_FIELD_NAME]: csrfToken, name: "" }),
      );

      expect(result.errors.name?.[0]).toBeTruthy();
      const unchanged = await getProductById(existing.id);
      expect(unchanged?.name).toBe("Original Name");
    });

    it("updates the product's fields and redirects to the products list", async () => {
      const existing = await createProduct({
        slug: "test-update-action-success",
        name: "Original Name",
      });
      insertedIds.push(existing.id);

      await expect(
        updateProductAction(
          existing.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            name: "Updated Name",
            description: "A lovely scent.",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/admin/products");

      const updated = await getProductById(existing.id);
      expect(updated?.name).toBe("Updated Name");
      expect(updated?.description).toBe("A lovely scent.");
    });

    it("does not collide with its own current slug when the name is unchanged", async () => {
      // The slug already matches what slugify(name) would derive — this is
      // what makes a same-name re-save a genuine self-collision case
      // (generateUniqueProductSlug's excludeProductId short-circuit),
      // rather than just landing on an unrelated new slug.
      const existing = await createProduct({
        slug: "test-update-action-steady-name",
        name: "Test Update Action Steady Name",
      });
      insertedIds.push(existing.id);

      await expect(
        updateProductAction(
          existing.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            name: "Test Update Action Steady Name",
            careInfo: "Keep away from heat.",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/admin/products");

      const updated = await getProductById(existing.id);
      expect(updated?.slug).toBe("test-update-action-steady-name");
      expect(updated?.careInfo).toBe("Keep away from heat.");
    });
  });
});
