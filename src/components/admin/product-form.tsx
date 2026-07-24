"use client";

import { useActionState } from "react";

import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import type { ProductFormState } from "@/lib/actions/admin-products";

// Shared by both the create (4.3c) and edit screens — `action` is either
// `createProductAction` or `updateProductAction.bind(null, productId)`
// (`.bind` on a Server Action is itself a valid Server Action reference),
// so this component doesn't need to know which mode it's in. `useActionState`
// (not a plain redirect-with-query-param, the pattern the login/discount-
// code forms use) is what lets several independently-invalid fields each
// render their own message and keeps whatever the owner already typed in
// the *other* fields instead of discarding the whole submission — Next's
// Server Actions still work with `<form action={...}>` when JS is
// unavailable, this only changes how a *failed* submission's response is
// rendered.
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
}: {
  label: string;
  name: string;
  defaultValue: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
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

function TextAreaField({
  label,
  name,
  defaultValue,
  errors,
}: {
  label: string;
  name: string;
  defaultValue: string;
  errors?: string[];
}) {
  const errorId = `${name}-error`;

  return (
    <div>
      <label htmlFor={name} className={labelClassName()}>
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={4}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? errorId : undefined}
        className={inputClassName()}
      />
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

export function ProductForm({
  action,
  initialState,
  csrfToken,
  submitLabel,
}: {
  action: (
    state: ProductFormState,
    formData: FormData,
  ) => Promise<ProductFormState>;
  initialState: ProductFormState;
  csrfToken: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
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
        label="Name"
        name="name"
        defaultValue={state.values.name}
        errors={state.errors.name}
        required
      />
      <Field
        label="Slug"
        name="slug"
        defaultValue={state.values.slug}
        errors={state.errors.slug}
        hint="Leave blank to generate automatically from the name."
      />
      <TextAreaField
        label="Description"
        name="description"
        defaultValue={state.values.description}
        errors={state.errors.description}
      />
      <TextAreaField
        label="Ingredients"
        name="ingredients"
        defaultValue={state.values.ingredients}
        errors={state.errors.ingredients}
      />
      <TextAreaField
        label="Safety info"
        name="safetyInfo"
        defaultValue={state.values.safetyInfo}
        errors={state.errors.safetyInfo}
      />
      <TextAreaField
        label="Care info"
        name="careInfo"
        defaultValue={state.values.careInfo}
        errors={state.errors.careInfo}
      />

      <button
        type="submit"
        className="mt-2 self-start rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
      >
        {submitLabel}
      </button>
    </form>
  );
}
