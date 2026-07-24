"use client";

import { useActionState } from "react";

import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import type { StockAdjustmentFormState } from "@/lib/actions/admin-inventory";
import { stockAdjustmentReasons } from "@/lib/validation/stock-adjustment-form";

// 4.4b's per-variant adjustment form, rendered inside the same per-row
// `<details>` variant-list.tsx already opens for VariantForm (4.4a's own
// NOTE) — alongside it, not replacing it. Writes go through
// adjustStockAction, which only ever calls recordMovement; this form never
// submits a stock number, only a signed delta + reason + optional note.

const reasonLabels: Record<(typeof stockAdjustmentReasons)[number], string> = {
  adjustment: "Adjustment (recount, correction)",
  damage: "Damage / loss",
};

export function StockAdjustmentForm({
  action,
  initialState,
  csrfToken,
}: {
  action: (
    state: StockAdjustmentFormState,
    formData: FormData,
  ) => Promise<StockAdjustmentFormState>;
  initialState: StockAdjustmentFormState;
  csrfToken: string;
}) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col gap-4 border-t border-ink/10 pt-4"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />

      {state.formError && (
        <p
          role="alert"
          className="rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {state.formError}
        </p>
      )}

      <div>
        <label htmlFor="delta" className="block text-sm font-medium text-ink">
          Adjust stock by
        </label>
        <input
          id="delta"
          name="delta"
          type="text"
          inputMode="numeric"
          required
          defaultValue={state.values.delta}
          aria-invalid={state.errors.delta?.length ? true : undefined}
          aria-describedby={
            state.errors.delta?.length ? "delta-error" : "delta-hint"
          }
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
        />
        <p id="delta-hint" className="mt-1 text-xs text-ink/60">
          Positive to add, negative to remove, e.g. -3
        </p>
        {state.errors.delta?.[0] && (
          <p
            id="delta-error"
            role="alert"
            className="mt-1 text-xs text-lavender-dark"
          >
            {state.errors.delta[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="reason" className="block text-sm font-medium text-ink">
          Reason
        </label>
        <select
          id="reason"
          name="reason"
          required
          defaultValue={state.values.reason}
          aria-invalid={state.errors.reason?.length ? true : undefined}
          aria-describedby={
            state.errors.reason?.length ? "reason-error" : undefined
          }
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Select a reason
          </option>
          {stockAdjustmentReasons.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabels[reason]}
            </option>
          ))}
        </select>
        {state.errors.reason?.[0] && (
          <p
            id="reason-error"
            role="alert"
            className="mt-1 text-xs text-lavender-dark"
          >
            {state.errors.reason[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-ink">
          Note (optional)
        </label>
        <textarea
          id="note"
          name="note"
          defaultValue={state.values.note}
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        className="mt-2 self-start rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
      >
        Record adjustment
      </button>
    </form>
  );
}
