"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { getCurrentAdminUserId } from "@/lib/auth/current-admin";
import { createAuditLogEntry } from "@/lib/repos/audit-log";
import {
  createVariant,
  getVariantBySku,
  getVariantById,
  updateVariant,
} from "@/lib/repos/variants";
import {
  parseVariantForm,
  variantFormFieldErrors,
  type VariantFormInput,
  type VariantFormValues,
} from "@/lib/validation/variant-form";

// Server Actions for 4.4a's variant editor, extending the product edit page
// per 4.3c's own NOTE (not a separate route). Same layering/CSRF/state-return
// conventions as admin-products.ts: a form with several independently-invalid
// fields returns a state object for useActionState rather than redirecting
// with a single `?error=` reason, so a failed submit doesn't lose whatever
// the owner already typed into the other fields.

export type VariantFormState = {
  errors: Partial<Record<keyof VariantFormInput, string[]>>;
  values: VariantFormValues;
  formError?: string;
};

function rawFormValues(formData: FormData): VariantFormValues {
  const get = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    sku: get("sku"),
    name: get("name"),
    priceCents: get("priceCents"),
    compareAtPriceCents: get("compareAtPriceCents"),
    weightGrams: get("weightGrams"),
    isActive: formData.get("isActive") === "on",
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
const SKU_TAKEN_ERROR = "This SKU is already in use by another variant.";

function editPagePath(productId: string): string {
  return `/admin/products/${productId}/edit`;
}

export async function createVariantAction(
  productId: string,
  _prevState: VariantFormState,
  formData: FormData,
): Promise<VariantFormState> {
  const values = rawFormValues(formData);

  if (!(await csrfOk(formData))) {
    return { errors: {}, values, formError: CSRF_FORM_ERROR };
  }

  const result = parseVariantForm(formData);
  if (!result.success) {
    return { errors: variantFormFieldErrors(result), values };
  }

  const skuOwner = await getVariantBySku(result.data.sku);
  if (skuOwner) {
    return { errors: { sku: [SKU_TAKEN_ERROR] }, values };
  }

  const created = await createVariant({
    productId,
    sku: result.data.sku,
    name: result.data.name,
    priceCents: result.data.priceCents,
    compareAtPriceCents: result.data.compareAtPriceCents ?? null,
    weightGrams: result.data.weightGrams,
    isActive: result.data.isActive,
  });

  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "create_variant",
    entityType: "variant",
    entityId: created.id,
    before: null,
    after: {
      sku: created.sku,
      name: created.name,
      priceCents: created.priceCents,
      compareAtPriceCents: created.compareAtPriceCents,
      weightGrams: created.weightGrams,
      isActive: created.isActive,
    },
  });

  revalidatePath(editPagePath(productId));
  redirect(editPagePath(productId));
}

export async function updateVariantAction(
  variantId: string,
  _prevState: VariantFormState,
  formData: FormData,
): Promise<VariantFormState> {
  const values = rawFormValues(formData);

  if (!(await csrfOk(formData))) {
    return { errors: {}, values, formError: CSRF_FORM_ERROR };
  }

  const existing = await getVariantById(variantId);
  if (!existing) {
    return { errors: {}, values, formError: "Variant not found." };
  }

  const result = parseVariantForm(formData);
  if (!result.success) {
    return { errors: variantFormFieldErrors(result), values };
  }

  const skuOwner = await getVariantBySku(result.data.sku);
  if (skuOwner && skuOwner.id !== variantId) {
    return { errors: { sku: [SKU_TAKEN_ERROR] }, values };
  }

  const updated = await updateVariant(variantId, {
    sku: result.data.sku,
    name: result.data.name,
    priceCents: result.data.priceCents,
    compareAtPriceCents: result.data.compareAtPriceCents ?? null,
    weightGrams: result.data.weightGrams,
    isActive: result.data.isActive,
  });

  await createAuditLogEntry({
    adminUserId: (await getCurrentAdminUserId()) ?? null,
    action: "update_variant",
    entityType: "variant",
    entityId: variantId,
    before: {
      sku: existing.sku,
      name: existing.name,
      priceCents: existing.priceCents,
      compareAtPriceCents: existing.compareAtPriceCents,
      weightGrams: existing.weightGrams,
      isActive: existing.isActive,
    },
    after: {
      sku: updated?.sku,
      name: updated?.name,
      priceCents: updated?.priceCents,
      compareAtPriceCents: updated?.compareAtPriceCents,
      weightGrams: updated?.weightGrams,
      isActive: updated?.isActive,
    },
  });

  revalidatePath(editPagePath(existing.productId));
  redirect(editPagePath(existing.productId));
}
