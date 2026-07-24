"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { createProduct, updateProduct } from "@/lib/repos/products";
import { generateUniqueProductSlug } from "@/lib/services/product-slug";
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
