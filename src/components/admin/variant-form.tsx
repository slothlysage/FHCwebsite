"use client";

import { useActionState } from "react";

import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import type { VariantFormState } from "@/lib/actions/admin-variants";

// Shared by the "add variant" and per-row "edit variant" forms on the
// product edit page (4.4a) — same useActionState shape as ProductForm
// (product-form.tsx), rendering per-field errors and a form-level csrf/
// not-found error without discarding whatever the owner already typed.
function labelClassName() {
  return "block text-sm font-medium text-ink";
}

function inputClassName() {
  return "mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm";
}

function Field({
  label,
  name,
  defaultValue,
  errors,
  hint,
  required,
  inputMode,
}: {
  label: string;
  name: string;
  defaultValue: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy =
    [errors?.length ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <label htmlFor={name} className={labelClassName()}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        inputMode={inputMode}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className={inputClassName()}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink/60">
          {hint}
        </p>
      )}
      {errors?.[0] && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs text-lavender-dark"
        >
          {errors[0]}
        </p>
      )}
    </div>
  );
}

export function VariantForm({
  action,
  initialState,
  csrfToken,
  submitLabel,
}: {
  action: (
    state: VariantFormState,
    formData: FormData,
  ) => Promise<VariantFormState>;
  initialState: VariantFormState;
  csrfToken: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />

      {state.formError && (
        <p
          role="alert"
          className="rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {state.formError}
        </p>
      )}

      <Field
        label="SKU"
        name="sku"
        defaultValue={state.values.sku}
        errors={state.errors.sku}
        required
      />
      <Field
        label="Name"
        name="name"
        defaultValue={state.values.name}
        errors={state.errors.name}
        required
      />
      <Field
        label="Price"
        name="priceCents"
        defaultValue={state.values.priceCents}
        errors={state.errors.priceCents}
        hint="Dollars, e.g. 24.99"
        inputMode="decimal"
        required
      />
      <Field
        label="Compare-at price"
        name="compareAtPriceCents"
        defaultValue={state.values.compareAtPriceCents}
        errors={state.errors.compareAtPriceCents}
        hint="Optional. Leave blank for no compare-at price."
        inputMode="decimal"
      />
      <Field
        label="Weight (grams)"
        name="weightGrams"
        defaultValue={state.values.weightGrams}
        errors={state.errors.weightGrams}
        inputMode="numeric"
        required
      />

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={state.values.isActive}
          className="h-4 w-4 rounded border-ink/20"
        />
        <label htmlFor="isActive" className="text-sm font-medium text-ink">
          Active
        </label>
      </div>

      <button
        type="submit"
        className="mt-2 self-start rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
      >
        {submitLabel}
      </button>
    </form>
  );
}
