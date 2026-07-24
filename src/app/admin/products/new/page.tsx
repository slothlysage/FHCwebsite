import {
  createProductAction,
  type ProductFormState,
} from "@/lib/actions/admin-products";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { emptyProductFormValues } from "@/lib/validation/product-form";
import { ProductForm } from "@/components/admin/product-form";

// Reads the csrf_token cookie — Next opts this route into dynamic rendering
// for that reason alone, same rationale as the login page's own explicit
// export.
export const dynamic = "force-dynamic";

const initialState: ProductFormState = {
  errors: {},
  values: emptyProductFormValues,
};

export default async function NewProductPage() {
  const csrfToken = (await readCsrfCookie()) ?? "";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        New product
      </h1>
      <ProductForm
        action={createProductAction}
        initialState={initialState}
        csrfToken={csrfToken}
        submitLabel="Create product"
      />
    </div>
  );
}
