import Link from "next/link";

import { formatPriceCents } from "@/lib/format";
import type { ProductListingItem } from "@/lib/services/product-listing";

export function ProductCard({ product }: { product: ProductListingItem }) {
  return (
    <li className="group">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="aspect-square overflow-hidden rounded-md bg-sand">
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- real image hosting/next-image sizing lands in 4.5/5.4
            <img
              src={product.image.url}
              alt={product.image.altText}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-ink/50">
              No image
            </div>
          )}
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-ink">{product.name}</h3>
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-ink/70">
          {product.priceFromCents !== null && (
            <span>From {formatPriceCents(product.priceFromCents)}</span>
          )}
          {!product.inStock && product.purchasable && (
            <span className="text-ink/60">Made to order</span>
          )}
          {!product.inStock && !product.purchasable && (
            <span className="text-clay-dark font-medium">Out of stock</span>
          )}
        </div>
      </Link>
    </li>
  );
}
