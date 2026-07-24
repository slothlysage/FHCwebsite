import type { VariantFormState } from "@/lib/actions/admin-variants";
import { centsToDollarsInput, formatPriceCents } from "@/lib/format";
import { emptyVariantFormValues } from "@/lib/validation/variant-form";

import { VariantForm } from "./variant-form";

// 4.4a's variants section on the product edit page — extends the existing
// editor rather than adding a new route (4.3c's own NOTE). A plain HTML
// `<details>`/`<summary>` disclosure hides each variant's edit form behind
// its summary row without any client-side state of its own: this stays a
// Server Component (no "use client"), and the disclosure still works with
// JS disabled, same "progressive enhancement first" precedent as the
// storefront cart's own forms.

export type VariantListItem = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  weightGrams: number;
  isActive: boolean;
};

type VariantAction = (
  state: VariantFormState,
  formData: FormData,
) => Promise<VariantFormState>;

function variantInitialState(variant: VariantListItem): VariantFormState {
  return {
    errors: {},
    values: {
      sku: variant.sku,
      name: variant.name,
      priceCents: centsToDollarsInput(variant.priceCents),
      compareAtPriceCents: centsToDollarsInput(variant.compareAtPriceCents),
      weightGrams: String(variant.weightGrams),
      isActive: variant.isActive,
    },
  };
}

export function VariantList({
  variants,
  csrfToken,
  createAction,
  updateAction,
}: {
  variants: VariantListItem[];
  csrfToken: string;
  createAction: VariantAction;
  // A factory, not a single bound action — each row needs its own variant id
  // bound in, and a plain `.bind(null, id)` can't be produced once up front
  // for every row.
  updateAction: (variantId: string) => VariantAction;
}) {
  return (
    <div className="mt-8 border-t border-ink/10 pt-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        Variants
      </h2>

      {variants.length === 0 ? (
        <p className="mt-2 text-sm text-ink/70">No variants yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {variants.map((variant) => (
            <li
              key={variant.id}
              className="rounded-md border border-ink/10 p-4"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-ink">{variant.sku}</span>
                <span className="text-ink">{variant.name}</span>
                <span className="text-ink">
                  {formatPriceCents(variant.priceCents)}
                </span>
                {variant.compareAtPriceCents !== null && (
                  <span className="text-ink/60 line-through">
                    {formatPriceCents(variant.compareAtPriceCents)}
                  </span>
                )}
                <span className="text-ink/70">{variant.weightGrams}g</span>
                <span className="text-ink/70">
                  Status: {variant.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <details className="mt-2" aria-label={`Edit ${variant.sku}`}>
                <summary className="cursor-pointer text-sm font-medium text-lavender-dark">
                  Edit
                </summary>
                <VariantForm
                  action={updateAction(variant.id)}
                  initialState={variantInitialState(variant)}
                  csrfToken={csrfToken}
                  submitLabel="Save variant"
                />
              </details>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-medium text-lavender-dark">
          Add variant
        </summary>
        <VariantForm
          action={createAction}
          initialState={{ errors: {}, values: emptyVariantFormValues }}
          csrfToken={csrfToken}
          submitLabel="Add variant"
        />
      </details>
    </div>
  );
}
