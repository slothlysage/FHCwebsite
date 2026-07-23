"use client";

import { useState } from "react";

import { formatPriceCents } from "@/lib/format";
import type { ProductDetailVariant } from "@/lib/services/product-detail";

// Selecting a variant updates price/stock instantly (specs/03-storefront.md)
// via local state — it deliberately does NOT call next/navigation's
// router.replace, which would re-fetch the server component and defeat the
// "without a full reload" requirement. `history.replaceState` keeps the
// `?variant=sku` URL linkable (spec) without that round trip. The
// surrounding <form method="GET"> and its always-visible submit button are
// what make variant selection work with JS disabled — same progressive-
// enhancement pattern as ProductFiltersForm (2.3): the fallback control
// isn't hidden just because JS happens to be available.
export function VariantSelector({
  variants,
  initialSku,
  productSlug,
}: {
  variants: ProductDetailVariant[];
  initialSku: string;
  productSlug: string;
}) {
  const [selectedSku, setSelectedSku] = useState(initialSku);

  if (variants.length === 0) {
    return <p className="mt-4 text-sm text-ink/70">Currently unavailable.</p>;
  }

  const selected =
    variants.find((variant) => variant.sku === selectedSku) ?? variants[0]!;

  function handleChange(sku: string) {
    setSelectedSku(sku);
    const params = new URLSearchParams(window.location.search);
    params.set("variant", sku);
    window.history.replaceState(
      null,
      "",
      `/products/${productSlug}?${params.toString()}`,
    );
  }

  return (
    <div className="mt-4">
      <p aria-live="polite" className="text-xl font-semibold text-ink">
        {formatPriceCents(selected.priceCents)}
      </p>
      <p
        aria-live="polite"
        className={
          selected.stock > 0
            ? "mt-1 text-sm text-ink/70"
            : "mt-1 text-sm font-medium text-clay-dark"
        }
      >
        {selected.stock > 0 ? "In stock" : "Out of stock"}
      </p>
      <p className="mt-1 text-xs text-ink/50">
        Ships at {selected.weightGrams}g
      </p>
      <form
        method="GET"
        action={`/products/${productSlug}`}
        className="mt-4 flex items-end gap-2"
      >
        <div>
          <label
            htmlFor="variant-select"
            className="block text-xs font-medium text-ink"
          >
            Variant
          </label>
          <select
            id="variant-select"
            name="variant"
            value={selectedSku}
            onChange={(event) => handleChange(event.target.value)}
            className="mt-1 rounded-md border border-ink/20 px-2 py-1.5 text-sm"
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.sku}>
                {variant.name} — {formatPriceCents(variant.priceCents)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-ink/20 px-3 py-1.5 text-sm"
        >
          Update
        </button>
      </form>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Cart is coming soon"
        className="mt-4 w-full rounded-md bg-clay px-4 py-2 text-sm font-medium text-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add to cart
      </button>
    </div>
  );
}
