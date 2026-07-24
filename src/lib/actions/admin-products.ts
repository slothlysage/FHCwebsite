"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { getCurrentAdminUserId } from "@/lib/auth/current-admin";
import { createAuditLogEntry } from "@/lib/repos/audit-log";
import { listImagesByProductId } from "@/lib/repos/images";
import {
  createProduct,
  getProductById,
  softDeleteProduct,
  updateProduct,
} from "@/lib/repos/products";
import { listVariantsByProductId } from "@/lib/repos/variants";
import { generateUniqueProductSlug } from "@/lib/services/product-slug";
import {
  checkPublishGate,
  type PublishGateFailure,
} from "@/lib/services/product-publish-gate";
import {
  parseProductForm,
  productFormFieldErrors,
  type ProductFormInput,
  type ProductFormValues,
} from "@/lib/validation/product-form";

// Server Actions for 4.3c's create/edit screens — thin orchestration over
// 4.3a's shared validation (product-form.ts, product-slug.ts) and the
// products repo, same layering `admin-auth.ts`/`cart.ts` already establish.
// Unlike those two, this form has several fields that can each fail
// independently, so it returns a state object (consumed by
// `useActionState` in the client `ProductForm` component) instead of
// redirecting with a single `?error=` reason — redirecting on validation
// failure would also lose whatever the owner had already typed into the
// other fields.

const PRODUCTS_PATH = "/admin/products";

export type ProductFormState = {
  errors: Partial<Record<keyof ProductFormInput, string[]>>;
  values: ProductFormValues;
  formError?: string;
};

function rawFormValues(formData: FormData): ProductFormValues {
  const get = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: get("name"),
    slug: get("slug"),
    description: get("description"),
    ingredients: get("ingredients"),
    safetyInfo: get("safetyInfo"),
    careInfo: get("careInfo"),
  };
}

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

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const values = rawFormValues(formData);

  if (!(await csrfOk(formData))) {
    return { errors: {}, values, formError: CSRF_FORM_ERROR };
  }

  const result = parseProductForm(formData);
  if (!result.success) {
    return { errors: productFormFieldErrors(result), values };
  }

  const slug = await generateUniqueProductSlug(result.data.name, {
    manualSlug: result.data.slug,
  });
  await createProduct({
    name: result.data.name,
    slug,
    description: result.data.description ?? null,
    ingredients: result.data.ingredients ?? null,
    safetyInfo: result.data.safetyInfo ?? null,
    careInfo: result.data.careInfo ?? null,
  });

  revalidatePath(PRODUCTS_PATH);
  redirect(PRODUCTS_PATH);
}

// 4.3d — publish/unpublish/soft-delete. Same module, same CSRF/state-return
// conventions as the two actions above (see 4.3c's NOTE). `useActionState`
// still fits here even though these forms have no per-field input: it's
// what lets a publish-gate failure (or a csrf mismatch) render as an alert
// on the edit page instead of a generic thrown error.
export type MutationState = {
  formError?: string;
};

const PUBLISH_GATE_MESSAGES: Record<PublishGateFailure, string> = {
  no_image_with_alt_text: "add at least one image with alt text",
  no_active_priced_variant: "add at least one active variant with a price",
  missing_ingredients: "fill in ingredients",
  missing_safety_info: "fill in safety info",
};

function editPagePath(productId: string): string {
  return `${PRODUCTS_PATH}/${productId}/edit`;
}

export async function publishProductAction(
  productId: string,
  _prevState: MutationState,
  formData: FormData,
): Promise<MutationState> {
  if (!(await csrfOk(formData))) {
    return { formError: CSRF_FORM_ERROR };
  }

  const product = await getProductById(productId);
  if (!product) {
    return { formError: "Product not found." };
  }

  const [images, variants] = await Promise.all([
    listImagesByProductId(productId),
    listVariantsByProductId(productId),
  ]);
  const gate = checkPublishGate({
    product: {
      ingredients: product.ingredients,
      safetyInfo: product.safetyInfo,
    },
    images,
    variants,
  });
  if (!gate.ok) {
    return {
      formError: `Cannot publish yet — ${gate.failures.map((failure) => PUBLISH_GATE_MESSAGES[failure]).join(", ")}.`,
    };
  }

  const updated = await updateProduct(productId, { status: "published" });
  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "publish_product",
    entityType: "product",
    entityId: productId,
    before: { status: product.status },
    after: { status: updated?.status ?? "published" },
  });

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(editPagePath(productId));
  redirect(editPagePath(productId));
}

export async function unpublishProductAction(
  productId: string,
  _prevState: MutationState,
  formData: FormData,
): Promise<MutationState> {
  if (!(await csrfOk(formData))) {
    return { formError: CSRF_FORM_ERROR };
  }

  const product = await getProductById(productId);
  if (!product) {
    return { formError: "Product not found." };
  }

  const updated = await updateProduct(productId, { status: "draft" });
  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "unpublish_product",
    entityType: "product",
    entityId: productId,
    before: { status: product.status },
    after: { status: updated?.status ?? "draft" },
  });

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(editPagePath(productId));
  redirect(editPagePath(productId));
}

export async function softDeleteProductAction(
  productId: string,
  _prevState: MutationState,
  formData: FormData,
): Promise<MutationState> {
  if (!(await csrfOk(formData))) {
    return { formError: CSRF_FORM_ERROR };
  }

  const product = await getProductById(productId);
  if (!product) {
    return { formError: "Product not found." };
  }

  const deleted = await softDeleteProduct(productId);
  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "soft_delete_product",
    entityType: "product",
    entityId: productId,
    before: { deletedAt: null },
    after: { deletedAt: (deleted?.deletedAt ?? new Date()).toISOString() },
  });

  revalidatePath(PRODUCTS_PATH);
  redirect(PRODUCTS_PATH);
}

export async function updateProductAction(
  productId: string,
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const values = rawFormValues(formData);

  if (!(await csrfOk(formData))) {
    return { errors: {}, values, formError: CSRF_FORM_ERROR };
  }

  const result = parseProductForm(formData);
  if (!result.success) {
    return { errors: productFormFieldErrors(result), values };
  }

  const slug = await generateUniqueProductSlug(result.data.name, {
    manualSlug: result.data.slug,
    excludeProductId: productId,
  });
  await updateProduct(productId, {
    name: result.data.name,
    slug,
    description: result.data.description ?? null,
    ingredients: result.data.ingredients ?? null,
    safetyInfo: result.data.safetyInfo ?? null,
    careInfo: result.data.careInfo ?? null,
  });

  revalidatePath(PRODUCTS_PATH);
  redirect(PRODUCTS_PATH);
}
