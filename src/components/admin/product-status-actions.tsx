"use client";

import { useActionState } from "react";

import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import type { MutationState } from "@/lib/actions/admin-products";

// 4.3d — publish/unpublish/soft-delete, rendered on the edit screen only (a
// product must exist to have a status or be deletable). Three independent
// `useActionState` forms rather than one, so a publish-gate failure alert
// doesn't get tangled up with the delete confirmation flow.
const initialMutationState: MutationState = {};

function MutationForm({
  action,
  csrfToken,
  label,
  buttonClassName,
  confirmMessage,
}: {
  action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  csrfToken: string;
  label: string;
  buttonClassName: string;
  confirmMessage?: string;
}) {
  const [state, formAction] = useActionState(action, initialMutationState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <button type="submit" className={buttonClassName}>
        {label}
      </button>
      {state.formError && (
        <p role="alert" className="mt-2 text-xs text-lavender-dark">
          {state.formError}
        </p>
      )}
    </form>
  );
}

export function ProductStatusActions({
  productName,
  status,
  csrfToken,
  publishAction,
  unpublishAction,
  deleteAction,
}: {
  productName: string;
  status: string;
  csrfToken: string;
  publishAction: (
    state: MutationState,
    formData: FormData,
  ) => Promise<MutationState>;
  unpublishAction: (
    state: MutationState,
    formData: FormData,
  ) => Promise<MutationState>;
  deleteAction: (
    state: MutationState,
    formData: FormData,
  ) => Promise<MutationState>;
}) {
  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-ink/10 pt-6">
      <p className="text-sm text-ink/70">
        Status: <span className="font-medium text-ink">{status}</span>
      </p>
      <div className="flex flex-wrap gap-3">
        {status === "published" ? (
          <MutationForm
            action={unpublishAction}
            csrfToken={csrfToken}
            label="Unpublish"
            buttonClassName="rounded-md border border-ink/20 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          />
        ) : (
          <MutationForm
            action={publishAction}
            csrfToken={csrfToken}
            label="Publish"
            buttonClassName="rounded-md bg-sage px-4 py-2 text-sm font-semibold text-white hover:bg-sage-dark"
          />
        )}
        <MutationForm
          action={deleteAction}
          csrfToken={csrfToken}
          label="Delete product"
          buttonClassName="rounded-md border border-lavender-dark/40 px-4 py-2 text-sm font-medium text-lavender-dark hover:bg-lavender/10"
          confirmMessage={`Delete "${productName}"? This cannot be undone.`}
        />
      </div>
    </div>
  );
}
