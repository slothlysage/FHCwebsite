import { ProductCard } from "@/components/product-card";
import type { ProductListingItem } from "@/lib/services/product-listing";

export function ProductGrid({ products }: { products: ProductListingItem[] }) {
  if (products.length === 0) {
    return (
      <p className="py-16 text-center text-ink/70">
        No products match right now — check back soon.
      </p>
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
