import { z } from "zod";

// The admin variant editor (4.4a, specs/04-admin.md's Variants screen): SKU,
// name, price, compare-at price, weight, active flag. Shared client+server
// per AGENT.md — plain zod, no Node-only APIs. Money is entered in whole/
// fractional dollars (matching the storefront filter form's own
// dollarsToCentsSchema, src/lib/validation/product-filters.ts) and stored as
// integer cents (AGENT.md's money rule) — the server, not the client, owns
// the conversion.

function requiredTrimmedText(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

const dollarsToCentsSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative())
  .transform((dollars) => Math.round(dollars * 100));

const optionalDollarsToCentsSchema = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}, dollarsToCentsSchema.optional());

export const variantFormSchema = z.object({
  sku: z.preprocess(requiredTrimmedText, z.string().min(1, "SKU is required")),
  name: z.preprocess(
    requiredTrimmedText,
    z.string().min(1, "Name is required"),
  ),
  priceCents: dollarsToCentsSchema,
  compareAtPriceCents: optionalDollarsToCentsSchema,
  weightGrams: z
    .string()
    .trim()
    .transform((value) => Number(value))
    .pipe(z.number().int().nonnegative()),
  // A checkbox input is only present in FormData when checked ("on"); absent
  // entirely otherwise — there is no unchecked value to parse.
  isActive: z.preprocess((value) => value === "on", z.boolean()),
});

export type VariantFormInput = z.infer<typeof variantFormSchema>;

// The admin editor's raw, string-only field shape — every field
// controlled/pre-filled as a plain string (or boolean for the checkbox),
// before variantFormSchema's own trim/dollars-to-cents rules run. Shared by
// the create and edit forms to seed a blank vs. an existing variant.
export type VariantFormValues = {
  sku: string;
  name: string;
  priceCents: string;
  compareAtPriceCents: string;
  weightGrams: string;
  isActive: boolean;
};

export const emptyVariantFormValues: VariantFormValues = {
  sku: "",
  name: "",
  priceCents: "",
  compareAtPriceCents: "",
  weightGrams: "",
  isActive: true,
};

export function parseVariantForm(
  formData: FormData,
): z.ZodSafeParseResult<VariantFormInput> {
  return variantFormSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    priceCents: formData.get("priceCents"),
    compareAtPriceCents: formData.get("compareAtPriceCents"),
    weightGrams: formData.get("weightGrams"),
    isActive: formData.get("isActive"),
  });
}

// Per-field error messages for the editor form — an empty object for a
// successful parse, mirroring product-form.ts's own contract.
export function variantFormFieldErrors(
  result: z.ZodSafeParseResult<VariantFormInput>,
): Partial<Record<keyof VariantFormInput, string[]>> {
  if (result.success) return {};
  return z.flattenError(result.error).fieldErrors;
}
