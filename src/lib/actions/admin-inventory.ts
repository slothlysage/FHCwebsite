"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { getCurrentAdminUserId } from "@/lib/auth/current-admin";
import { createAuditLogEntry } from "@/lib/repos/audit-log";
import { getStockForVariant, recordMovement } from "@/lib/repos/inventory";
import { getVariantById } from "@/lib/repos/variants";
import {
  parseStockAdjustmentForm,
  stockAdjustmentFormFieldErrors,
  type StockAdjustmentFormInput,
  type StockAdjustmentFormValues,
} from "@/lib/validation/stock-adjustment-form";

// The stock-adjustment ledger UI's Server Action (4.4b, specs/04-admin.md's
// Variants screen). The only write here is recordMovement — same repo
// function catalog-import.ts and order-fulfillment.ts use — so stock is
// never set directly, only ever derived from the movement ledger
// (AGENT.md's money/inventory rule, this task's own AC).

export type StockAdjustmentFormState = {
  errors: Partial<Record<keyof StockAdjustmentFormInput, string[]>>;
  values: StockAdjustmentFormValues;
  formError?: string;
};

function rawFormValues(formData: FormData): StockAdjustmentFormValues {
  const get = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    delta: get("delta"),
    reason: get("reason"),
    note: get("note"),
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

function editPagePath(productId: string): string {
  return `/admin/products/${productId}/edit`;
}

export async function adjustStockAction(
  variantId: string,
  _prevState: StockAdjustmentFormState,
  formData: FormData,
): Promise<StockAdjustmentFormState> {
  const values = rawFormValues(formData);

  if (!(await csrfOk(formData))) {
    return { errors: {}, values, formError: CSRF_FORM_ERROR };
  }

  const variant = await getVariantById(variantId);
  if (!variant) {
    return { errors: {}, values, formError: "Variant not found." };
  }

  const result = parseStockAdjustmentForm(formData);
  if (!result.success) {
    return { errors: stockAdjustmentFormFieldErrors(result), values };
  }

  const adminUserId = (await getCurrentAdminUserId()) ?? null;
  const before = await getStockForVariant(variantId);

  await recordMovement({
    variantId,
    delta: result.data.delta,
    reason: result.data.reason,
    note: result.data.note ?? null,
    createdBy: adminUserId,
  });

  await createAuditLogEntry({
    adminUserId,
    action: "adjust_stock",
    entityType: "variant",
    entityId: variantId,
    before: { stock: before },
    after: {
      stock: before + result.data.delta,
      delta: result.data.delta,
      reason: result.data.reason,
      note: result.data.note ?? null,
    },
  });

  revalidatePath(editPagePath(variant.productId));
  redirect(editPagePath(variant.productId));
}
