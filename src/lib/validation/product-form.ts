import { z } from "zod";

// The admin product editor's create/edit form (specs/04-admin.md's Products
// screen): name, slug (auto with manual override), description, ingredients,
// safety_info, care_info. Shared client+server per AGENT.md — plain zod, no
// Node-only APIs, so the same module can back client-side field errors and
// the authoritative Server Action check.
//
// Slug format matches slugify.ts's own output exactly (lowercase
// alphanumeric segments joined by single hyphens) — a manually-entered
// override still has to survive the same collision-checking
// (product-slug.ts) as a machine-generated one, so it must already look
// like one.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// FormData.get() returns null for an absent field and can return a File for
// a same-named <input type="file">; neither is a string worth validating,
// so both collapse to undefined ("not provided") rather than a type error.
// A present-but-blank/whitespace-only value is treated the same way — an
// empty textarea means "no value", not an empty-string value to store.
function optionalTrimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export const productFormSchema = z.object({
  name: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1, "Name is required"),
  ),
  slug: z.preprocess(
    optionalTrimmedText,
    z
      .string()
      .regex(
        SLUG_PATTERN,
        "Slug must be lowercase letters, numbers, and hyphens only",
      )
      .optional(),
  ),
  description: z.preprocess(optionalTrimmedText, z.string().optional()),
  ingredients: z.preprocess(optionalTrimmedText, z.string().optional()),
  safetyInfo: z.preprocess(optionalTrimmedText, z.string().optional()),
  careInfo: z.preprocess(optionalTrimmedText, z.string().optional()),
});

export type ProductFormInput = z.infer<typeof productFormSchema>;

export function parseProductForm(
  formData: FormData,
): z.ZodSafeParseResult<ProductFormInput> {
  return productFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    ingredients: formData.get("ingredients"),
    safetyInfo: formData.get("safetyInfo"),
    careInfo: formData.get("careInfo"),
  });
}

// Per-field error messages for the editor form (AC: "validation errors
// render per-field") — an empty object for a successful parse, so a caller
// can key a form field's error slot directly off `errors.name?.[0]` etc.
// without an extra `.success` branch of its own.
export function productFormFieldErrors(
  result: z.ZodSafeParseResult<ProductFormInput>,
): Partial<Record<keyof ProductFormInput, string[]>> {
  if (result.success) return {};
  return z.flattenError(result.error).fieldErrors;
}
