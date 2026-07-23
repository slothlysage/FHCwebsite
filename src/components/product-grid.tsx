import type { ReactNode } from "react";

import { ProductCard } from "@/components/product-card";
import type { ProductListingItem } from "@/lib/services/product-listing";

export function ProductGrid({
  products,
  emptyMessage = "No products match right now — check back soon.",
  emptyAction,
}: {
  products: ProductListingItem[];
  emptyMessage?: string;
  emptyAction?: ReactNode;
}) {
  if (products.length === 0) {
    return (
      <div className="py-16 text-center text-ink/70">
        <p>{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  );
}
