"use client";

import { useActionState } from "react";

import type { ImageMutationState } from "@/lib/actions/admin-images";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import {
  altTextFieldName,
  deleteFieldName,
  positionFieldName,
} from "@/lib/validation/product-images-form";

// 4.5c's image manager on the product edit page. Two independent forms
// (edit-existing vs. add-new), same "several useActionState forms rather
// than one" rationale product-status-actions.tsx already established — an
// upload failure alert shouldn't get tangled up with the edit/delete flow.
// The edit form is field-named per image id (see product-images-form.ts),
// not by array index, so the server action can trust its own DB-fetched id
// list rather than anything the client submits.

export type ProductImageItem = {
  id: string;
  url: string;
  altText: string;
  position: number;
};

type ImageAction = (
  state: ImageMutationState,
  formData: FormData,
) => Promise<ImageMutationState>;

const initialState: ImageMutationState = {};

export function ImageManager({
  images,
  csrfToken,
  updateAction,
  uploadAction,
}: {
  images: ProductImageItem[];
  csrfToken: string;
  updateAction: ImageAction;
  uploadAction: ImageAction;
}) {
  const [updateState, updateFormAction] = useActionState(
    updateAction,
    initialState,
  );
  const [uploadState, uploadFormAction] = useActionState(
    uploadAction,
    initialState,
  );

  return (
    <div className="mt-8 border-t border-ink/10 pt-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Images</h2>

      {images.length === 0 ? (
        <p className="mt-2 text-sm text-ink/70">No images yet.</p>
      ) : (
        <form action={updateFormAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <ul className="flex flex-col gap-4">
            {images.map((image) => (
              <li
                key={image.id}
                className="flex flex-wrap items-center gap-4 rounded-md border border-ink/10 p-4"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail, not the storefront's optimized path */}
                <img
                  src={image.url}
                  alt={image.altText}
                  className="h-16 w-16 shrink-0 rounded object-cover"
                />
                <div className="flex flex-1 flex-wrap items-end gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor={altTextFieldName(image.id)}
                      className="block text-xs font-medium text-ink"
                    >
                      Alt text
                    </label>
                    <input
                      id={altTextFieldName(image.id)}
                      name={altTextFieldName(image.id)}
                      type="text"
                      required
                      defaultValue={image.altText}
                      className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="w-20">
                    <label
                      htmlFor={positionFieldName(image.id)}
                      className="block text-xs font-medium text-ink"
                    >
                      Position
                    </label>
                    <input
                      id={positionFieldName(image.id)}
                      name={positionFieldName(image.id)}
                      type="number"
                      defaultValue={image.position}
                      className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink/70">
                    <input type="checkbox" name={deleteFieldName(image.id)} />
                    Delete
                  </label>
                </div>
              </li>
            ))}
          </ul>
          {updateState.formError && (
            <p role="alert" className="text-sm text-lavender-dark">
              {updateState.formError}
            </p>
          )}
          <button
            type="submit"
            className="self-start rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
          >
            Save images
          </button>
        </form>
      )}

      <form
        action={uploadFormAction}
        className="mt-6 flex flex-col gap-4 border-t border-ink/10 pt-4"
      >
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <div>
          <label
            htmlFor="image-file"
            className="block text-sm font-medium text-ink"
          >
            Add image
          </label>
          <input
            id="image-file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="mt-1 block text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="new-image-alt-text"
            className="block text-sm font-medium text-ink"
          >
            Alt text
          </label>
          <input
            id="new-image-alt-text"
            name="altText"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
          />
        </div>
        {uploadState.formError && (
          <p role="alert" className="text-sm text-lavender-dark">
            {uploadState.formError}
          </p>
        )}
        <button
          type="submit"
          className="self-start rounded-md bg-sage px-5 py-2.5 text-sm font-semibold text-white hover:bg-sage-dark"
        >
          Upload image
        </button>
      </form>
    </div>
  );
}
