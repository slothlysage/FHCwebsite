import { notFound } from "next/navigation";

import {
  publishProductAction,
  softDeleteProductAction,
  unpublishProductAction,
  updateProductAction,
  type ProductFormState,
} from "@/lib/actions/admin-products";
import {
  createVariantAction,
  updateVariantAction,
} from "@/lib/actions/admin-variants";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { getProductById } from "@/lib/repos/products";
import { listVariantsByProductId } from "@/lib/repos/variants";
import { ProductForm } from "@/components/admin/product-form";
import { ProductStatusActions } from "@/components/admin/product-status-actions";
import { VariantList } from "@/components/admin/variant-list";

// Reads the csrf_token cookie — same rationale as the login/new-product
// pages' own explicit export.
export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) {
    notFound();
  }

  const variants = await listVariantsByProductId(product.id);
  const csrfToken = (await readCsrfCookie()) ?? "";
  const initialState: ProductFormState = {
    errors: {},
    values: {
      name: product.name,
      slug: product.slug,
      description: product.description ?? "",
      ingredients: product.ingredients ?? "",
      safetyInfo: product.safetyInfo ?? "",
      careInfo: product.careInfo ?? "",
    },
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Edit product
      </h1>
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        initialState={initialState}
        csrfToken={csrfToken}
        submitLabel="Save changes"
      />
      <ProductStatusActions
        productName={product.name}
        status={product.status}
        csrfToken={csrfToken}
        publishAction={publishProductAction.bind(null, product.id)}
        unpublishAction={unpublishProductAction.bind(null, product.id)}
        deleteAction={softDeleteProductAction.bind(null, product.id)}
      />
      <VariantList
        variants={variants}
        csrfToken={csrfToken}
        createAction={createVariantAction.bind(null, product.id)}
        updateAction={(variantId) => updateVariantAction.bind(null, variantId)}
      />
    </div>
  );
}
