import type { Metadata } from "next";

import { ProductGrid } from "@/components/product-grid";
import { getPublishedProductListing } from "@/lib/services/product-listing";

// Catalog and stock change independently of deploys (AGENT.md: the database
// is the source of truth for catalog/inventory) — a statically prerendered
// build would only ever show the snapshot from the last deploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop",
};

export default async function ProductsPage() {
  const products = await getPublishedProductListing();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Shop</h1>
      <div className="mt-8">
        <ProductGrid products={products} />
      </div>
    </div>
  );
}
