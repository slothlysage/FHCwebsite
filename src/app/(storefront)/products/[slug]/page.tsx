import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductGallery } from "@/components/product-gallery";
import { VariantSelector } from "@/components/variant-selector";
import { truncateForMeta } from "@/lib/format";
import {
  getProductDetail,
  type ProductDetail,
} from "@/lib/services/product-detail";

// Catalog/stock change independently of deploys (AGENT.md) — same rationale
// as /products (2.2): this route must never be statically prerendered.
export const dynamic = "force-dynamic";

// The canonical URL deliberately omits `?variant=` — the variant selector is
// UI state layered on one resource, not a distinct page, so every variant of
// a product shares one canonical rather than diluting signal across SKUs.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getProductDetail(slug);
  if (!detail) {
    // The page component itself calls notFound() for this same case; an
    // empty metadata object here just falls back to the root layout's
    // defaults rather than duplicating the not-found decision.
    return {};
  }
  return {
    title: detail.name,
    description: truncateForMeta(detail.description) ?? undefined,
    alternates: { canonical: `/products/${detail.slug}` },
  };
}

type DetailField = { label: string; value: string };

function detailFields(detail: ProductDetail): DetailField[] {
  const fields: DetailField[] = [];
  if (detail.description) {
    fields.push({ label: "Description", value: detail.description });
  }
  if (detail.ingredients) {
    fields.push({ label: "Ingredients", value: detail.ingredients });
  }
  const burnTime = detail.attributes.burn_time?.[0];
  if (burnTime) {
    fields.push({ label: "Burn time", value: burnTime });
  }
  if (detail.safetyInfo) {
    fields.push({ label: "Safety", value: detail.safetyInfo });
  }
  if (detail.careInfo) {
    fields.push({ label: "Care", value: detail.careInfo });
  }
  return fields;
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const { slug } = await params;
  const detail = await getProductDetail(slug);
  if (!detail) {
    notFound();
  }

  const { variant: rawVariant } = await searchParams;
  const requestedSku = typeof rawVariant === "string" ? rawVariant : undefined;
  const initialSku =
    detail.variants.find((variant) => variant.sku === requestedSku)?.sku ??
    detail.variants[0]?.sku ??
    "";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="lg:flex lg:gap-10">
        <ProductGallery images={detail.images} productName={detail.name} />
        <div className="mt-8 flex-1 lg:mt-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {detail.name}
          </h1>
          <VariantSelector
            variants={detail.variants}
            initialSku={initialSku}
            productSlug={detail.slug}
          />
          <dl className="mt-8 space-y-6 text-sm text-ink/80">
            {detailFields(detail).map((field) => (
              <div key={field.label}>
                <dt className="font-medium text-ink">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-line">{field.value}</dd>
              </div>
            ))}
            <div>
              <dt className="font-medium text-ink">Shipping</dt>
              <dd className="mt-1">Ships within 1–2 business days.</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
