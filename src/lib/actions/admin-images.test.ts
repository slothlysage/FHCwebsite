// @vitest-environment node
//
// sharp needs a real Node Buffer/typed-array realm — see image-upload.test.ts
// and specs/03-storefront.md's opengraph-image vitest gotcha for the same
// root cause. Integration tests against a real Postgres (specs/06-testing.md)
// plus R2 intercepted at the network boundary via msw (tests/msw/r2-server.ts,
// AGENT.md: "Mock at the network boundary, not by stubbing your own
// modules").
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import sharp from "sharp";

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
import { auditLog, productImages, products } from "@/lib/db/schema";
import { replaceProductImages } from "@/lib/repos/images";
import { createProduct } from "@/lib/repos/products";

import {
  type ImageMutationState,
  updateProductImagesAction,
  uploadProductImageAction,
} from "./admin-images";
import {
  getR2FakeObject,
  r2Server,
  resetR2FakeState,
} from "../../../tests/msw/r2-server";

function formData(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

async function makePngFile(name = "photo.png"): Promise<File> {
  const bytes = await makePng(500, 500);
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

const initialState: ImageMutationState = {};

beforeAll(() => r2Server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  r2Server.resetHandlers();
  resetR2FakeState();
});
afterAll(() => r2Server.close());

describe("uploadProductImageAction / updateProductImagesAction", () => {
  const productIds: string[] = [];
  let csrfToken: string;

  beforeEach(() => {
    csrfToken = generateCsrfToken();
    csrfCookie.token = csrfToken;
  });

  afterEach(async () => {
    for (const id of productIds.splice(0)) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id));
      await db.delete(productImages).where(eq(productImages.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
  });

  async function makeProduct(slug: string) {
    const product = await createProduct({ slug, name: slug });
    productIds.push(product.id);
    return product;
  }

  describe("uploadProductImageAction", () => {
    it("returns a form error and writes no row when the csrf field doesn't match", async () => {
      const product = await makeProduct("test-image-upload-csrf");
      const file = await makePngFile();

      const result = await uploadProductImageAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: "wrong-token",
          altText: "A candle",
          file,
        }),
      );

      expect(result.formError).toBeTruthy();
      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(0);
    });

    it("returns a form error and writes no row when alt text is blank", async () => {
      const product = await makeProduct("test-image-upload-no-alt");
      const file = await makePngFile();

      const result = await uploadProductImageAction(
        product.id,
        initialState,
        formData({ [CSRF_FIELD_NAME]: csrfToken, altText: "  ", file }),
      );

      expect(result.formError).toBeTruthy();
      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(0);
    });

    it("rejects a disguised-script upload and writes no product_images row", async () => {
      const product = await makeProduct("test-image-upload-disguised");
      const disguised = new File(
        [new TextEncoder().encode("#!/bin/sh\necho pwned\n")],
        "totally-a.png",
        { type: "image/png" },
      );

      const result = await uploadProductImageAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          altText: "A candle",
          file: disguised,
        }),
      );

      expect(result.formError).toMatch(/doesn't look like a supported image/i);
      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(0);
    });

    it("returns a form error for an unknown product", async () => {
      const file = await makePngFile();

      const result = await uploadProductImageAction(
        "00000000-0000-0000-0000-000000000000",
        initialState,
        formData({ [CSRF_FIELD_NAME]: csrfToken, altText: "A candle", file }),
      );

      expect(result.formError).toBeTruthy();
    });

    it("processes, uploads to R2, writes a product_images row, and redirects", async () => {
      const product = await makeProduct("test-image-upload-success");
      const file = await makePngFile();

      await expect(
        uploadProductImageAction(
          product.id,
          initialState,
          formData({ [CSRF_FIELD_NAME]: csrfToken, altText: "A candle", file }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.altText).toBe("A candle");
      expect(rows[0]!.position).toBe(0);
      expect(rows[0]!.width).toBeGreaterThan(0);
      expect(rows[0]!.url).toContain("large.webp");

      // All three responsive sizes were written server-side to R2, even
      // though only "large" is referenced by the DB row today.
      const key = decodeURIComponent(new URL(rows[0]!.url).pathname).replace(
        /^\//,
        "",
      );
      expect(getR2FakeObject(key)).toBeTruthy();
      expect(getR2FakeObject(key.replace("large", "thumbnail"))).toBeTruthy();
      expect(getR2FakeObject(key.replace("large", "medium"))).toBeTruthy();

      const [entry] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, product.id));
      expect(entry?.action).toBe("add_image");
    });

    it("appends after existing images at the next position", async () => {
      const product = await makeProduct("test-image-upload-position");
      await replaceProductImages(product.id, [
        {
          url: "https://example.com/a.jpg",
          altText: "Existing",
          position: 0,
          width: 100,
          height: 100,
        },
        {
          url: "https://example.com/b.jpg",
          altText: "Existing 2",
          position: 3,
          width: 100,
          height: 100,
        },
      ]);
      const file = await makePngFile();

      await expect(
        uploadProductImageAction(
          product.id,
          initialState,
          formData({ [CSRF_FIELD_NAME]: csrfToken, altText: "New", file }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(3);
      const added = rows.find((row) => row.altText === "New");
      expect(added?.position).toBe(4);
    });
  });

  describe("updateProductImagesAction", () => {
    async function seedImages(productId: string) {
      return replaceProductImages(productId, [
        {
          url: "https://example.com/a.jpg",
          altText: "First",
          position: 0,
          width: 100,
          height: 100,
        },
        {
          url: "https://example.com/b.jpg",
          altText: "Second",
          position: 1,
          width: 100,
          height: 100,
        },
      ]);
    }

    it("returns a form error and changes nothing when the csrf field doesn't match", async () => {
      const product = await makeProduct("test-image-update-csrf");
      const images = await seedImages(product.id);

      const result = await updateProductImagesAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: "wrong-token",
          [`altText__${images[0]!.id}`]: "Changed",
          [`position__${images[0]!.id}`]: "0",
          [`altText__${images[1]!.id}`]: "Second",
          [`position__${images[1]!.id}`]: "1",
        }),
      );

      expect(result.formError).toBeTruthy();
      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows.find((r) => r.id === images[0]!.id)?.altText).toBe("First");
    });

    it("returns a form error and changes nothing when a kept row's alt text is blank", async () => {
      const product = await makeProduct("test-image-update-blank-alt");
      const images = await seedImages(product.id);

      const result = await updateProductImagesAction(
        product.id,
        initialState,
        formData({
          [CSRF_FIELD_NAME]: csrfToken,
          [`altText__${images[0]!.id}`]: "  ",
          [`position__${images[0]!.id}`]: "0",
          [`altText__${images[1]!.id}`]: "Second",
          [`position__${images[1]!.id}`]: "1",
        }),
      );

      expect(result.formError).toMatch(/alt text is required/i);
      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(2);
    });

    it("updates alt text and position, and redirects", async () => {
      const product = await makeProduct("test-image-update-success");
      const images = await seedImages(product.id);

      await expect(
        updateProductImagesAction(
          product.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            [`altText__${images[0]!.id}`]: "Updated first",
            [`position__${images[0]!.id}`]: "5",
            [`altText__${images[1]!.id}`]: "Second",
            [`position__${images[1]!.id}`]: "1",
          }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(2);
      const updated = rows.find((r) => r.url === "https://example.com/a.jpg");
      expect(updated?.altText).toBe("Updated first");
      expect(updated?.position).toBe(5);
    });

    it("deletes a row marked for deletion and keeps the rest", async () => {
      const product = await makeProduct("test-image-update-delete");
      const images = await seedImages(product.id);

      await expect(
        updateProductImagesAction(
          product.id,
          initialState,
          formData({
            [CSRF_FIELD_NAME]: csrfToken,
            [`altText__${images[0]!.id}`]: "First",
            [`position__${images[0]!.id}`]: "0",
            [`delete__${images[0]!.id}`]: "on",
            [`altText__${images[1]!.id}`]: "Second",
            [`position__${images[1]!.id}`]: "1",
          }),
        ),
      ).rejects.toThrow(`REDIRECT:/admin/products/${product.id}/edit`);

      const rows = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.altText).toBe("Second");
    });
  });
});
