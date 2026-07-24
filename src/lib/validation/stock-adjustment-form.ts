import { z } from "zod";

// The admin stock-adjustment ledger UI (4.4b, specs/04-admin.md's Variants
// screen: "Stock is shown but not directly editable; adjusting stock opens
// an 'adjustment' form that writes an inventory_movements row with a
// required reason"). This form never writes a stock number itself — the
// server action (src/lib/actions/admin-inventory.ts) always goes through
// src/lib/repos/inventory.ts's recordMovement, the same function
// catalog-import.ts/order-fulfillment.ts use, so the ledger stays the only
// source of truth (AGENT.md's "no code path updates a stock number
// directly").
//
// Only a subset of inventoryReason's full enum (src/lib/db/schema.ts) is
// selectable here: "import"/"sale"/"refund" are written by system flows
// (the catalog importer, checkout, refunds) that already attribute their
// own reason — a human correcting a miscount or writing off damaged stock
// only ever means "adjustment" or "damage".
export const stockAdjustmentReasons = ["adjustment", "damage"] as const;
export type StockAdjustmentReason = (typeof stockAdjustmentReasons)[number];

const deltaSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(
    z
      .number()
      .int("Enter a whole number")
      .refine((value) => value !== 0, "Enter a non-zero amount"),
  );

export const stockAdjustmentFormSchema = z.object({
  delta: deltaSchema,
  reason: z.enum(stockAdjustmentReasons, "Select a reason"),
  note: z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().optional()),
});

export type StockAdjustmentFormInput = z.infer<
  typeof stockAdjustmentFormSchema
>;

// The raw, string-only field shape the form is controlled/re-rendered
// against on a failed submit — mirrors variant-form.ts's own
// VariantFormValues contract.
export type StockAdjustmentFormValues = {
  delta: string;
  reason: string;
  note: string;
};

export const emptyStockAdjustmentFormValues: StockAdjustmentFormValues = {
  delta: "",
  reason: "",
  note: "",
};

export function parseStockAdjustmentForm(
  formData: FormData,
): z.ZodSafeParseResult<StockAdjustmentFormInput> {
  return stockAdjustmentFormSchema.safeParse({
    delta: formData.get("delta"),
    reason: formData.get("reason"),
    note: formData.get("note"),
  });
}

export function stockAdjustmentFormFieldErrors(
  result: z.ZodSafeParseResult<StockAdjustmentFormInput>,
): Partial<Record<keyof StockAdjustmentFormInput, string[]>> {
  if (result.success) return {};
  return z.flattenError(result.error).fieldErrors;
}
