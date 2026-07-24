"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { getCurrentAdminUserId } from "@/lib/auth/current-admin";
import { createAuditLogEntry } from "@/lib/repos/audit-log";
import {
  listImagesByProductId,
  replaceProductImages,
} from "@/lib/repos/images";
import { getProductById } from "@/lib/repos/products";
import {
  type ImageProcessingError,
  processUploadedImage,
} from "@/lib/services/image-upload";
import { publicUrlForKey, putObject } from "@/lib/storage/r2";
import {
  altTextFieldName,
  deleteFieldName,
  parseImageUploadForm,
  positionFieldName,
} from "@/lib/validation/product-images-form";

// 4.5c: wires 4.5a's processing service and 4.5b's R2 client into the
// product edit page. Both actions below funnel through the same
// replaceProductImages (images.ts repo) — "replace the whole set" is that
// repo function's existing contract, so add/edit/delete/reorder all reduce
// to "fetch the current set, compute the new set, replace" rather than
// needing per-row create/update/delete repo functions.

export type ImageMutationState = { formError?: string };

async function csrfOk(formData: FormData): Promise<boolean> {
  const submitted = formData.get(CSRF_FIELD_NAME);
  const cookieToken = await readCsrfCookie();
  return csrfTokensMatch(
    typeof submitted === "string" ? submitted : undefined,
    cookieToken,
  );
}

const CSRF_FORM_ERROR =
  "Your session expired or the form was tampered with. Please refresh and try again.";

const UPLOAD_ERROR_MESSAGES: Record<ImageProcessingError, string> = {
  file_too_large: "That file is too large (max 10MB).",
  unrecognized_image_type:
    "That doesn't look like a supported image (PNG, JPEG, or WebP).",
};

function editPagePath(productId: string): string {
  return `/admin/products/${productId}/edit`;
}

// Server-side re-upload of 4.5a's processed sizes (specs/04-admin.md's
// 4.5b notes: the browser's presigned-PUT path is only for the raw
// original, since these derived sizes don't exist until sharp has run).
// Only the "large" size's URL is written to product_images — the storefront
// only renders a single url per row today (product-gallery.tsx,
// product-card.tsx); the smaller sizes are uploaded for 5.4's future
// srcset/picture work, not consumed anywhere yet.
async function storeProcessedImage(
  productId: string,
  altText: string,
  position: number,
  processed: Extract<
    Awaited<ReturnType<typeof processUploadedImage>>,
    { ok: true }
  >,
): Promise<{
  url: string;
  altText: string;
  position: number;
  width: number;
  height: number;
}> {
  const imageId = randomUUID();

  await Promise.all(
    processed.sizes.map((size) =>
      putObject(
        `products/${productId}/${imageId}/${size.label}.webp`,
        size.buffer,
        size.contentType,
      ),
    ),
  );

  const large = processed.sizes.find((size) => size.label === "large");
  if (!large) {
    throw new Error("processUploadedImage did not produce a 'large' size.");
  }

  return {
    url: publicUrlForKey(`products/${productId}/${imageId}/large.webp`),
    altText,
    position,
    width: large.width,
    height: large.height,
  };
}

export async function uploadProductImageAction(
  productId: string,
  _prevState: ImageMutationState,
  formData: FormData,
): Promise<ImageMutationState> {
  if (!(await csrfOk(formData))) {
    return { formError: CSRF_FORM_ERROR };
  }

  const product = await getProductById(productId);
  if (!product) {
    return { formError: "Product not found." };
  }

  const parsed = parseImageUploadForm(formData);
  if (!parsed.success) {
    return {
      formError: parsed.error.issues[0]?.message ?? "Alt text is required.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { formError: "Choose an image file to upload." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const processed = await processUploadedImage(buffer);
  if (!processed.ok) {
    return { formError: UPLOAD_ERROR_MESSAGES[processed.error] };
  }

  const existing = await listImagesByProductId(productId);
  const nextPosition =
    existing.reduce((max, image) => Math.max(max, image.position), -1) + 1;

  const newImage = await storeProcessedImage(
    productId,
    parsed.data.altText,
    nextPosition,
    processed,
  );

  await replaceProductImages(productId, [
    ...existing.map((image) => ({
      url: image.url,
      altText: image.altText,
      position: image.position,
      width: image.width,
      height: image.height,
    })),
    newImage,
  ]);

  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "add_image",
    entityType: "product",
    entityId: productId,
    before: null,
    after: { altText: newImage.altText, position: newImage.position },
  });

  revalidatePath(editPagePath(productId));
  redirect(editPagePath(productId));
}

export async function updateProductImagesAction(
  productId: string,
  _prevState: ImageMutationState,
  formData: FormData,
): Promise<ImageMutationState> {
  if (!(await csrfOk(formData))) {
    return { formError: CSRF_FORM_ERROR };
  }

  const product = await getProductById(productId);
  if (!product) {
    return { formError: "Product not found." };
  }

  const existing = await listImagesByProductId(productId);
  const kept: Array<{
    url: string;
    altText: string;
    position: number;
    width: number;
    height: number;
  }> = [];

  for (const image of existing) {
    if (formData.get(deleteFieldName(image.id)) === "on") {
      continue;
    }

    const altTextRaw = formData.get(altTextFieldName(image.id));
    const altText = typeof altTextRaw === "string" ? altTextRaw.trim() : "";
    if (altText.length === 0) {
      return { formError: "Alt text is required for every image." };
    }

    const positionRaw = formData.get(positionFieldName(image.id));
    const position = Number(positionRaw);
    if (!Number.isInteger(position)) {
      return { formError: "Position must be a whole number." };
    }

    kept.push({
      url: image.url,
      altText,
      position,
      width: image.width,
      height: image.height,
    });
  }

  await replaceProductImages(productId, kept);

  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "update_images",
    entityType: "product",
    entityId: productId,
    before: { count: existing.length },
    after: { count: kept.length },
  });

  revalidatePath(editPagePath(productId));
  redirect(editPagePath(productId));
}
