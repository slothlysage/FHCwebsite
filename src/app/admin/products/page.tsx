import Link from "next/link";

import { listAdminProducts } from "@/lib/services/admin-product-listing";
import {
  parseAdminProductFilters,
  type RawSearchParams,
} from "@/lib/validation/admin-product-filters";

// Catalog changes independently of deploys (AGENT.md: the database is the
// source of truth for catalog/inventory) — same rationale as every other
// catalog-backed route (2.2/2.5/2.9).
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["draft", "published", "archived"] as const;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseAdminProductFilters(await searchParams);
  const items = await listAdminProducts(filters);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Products
        </h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
        >
          Add product
        </Link>
      </div>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="search"
            className="block text-sm font-medium text-ink"
          >
            Search
          </label>
          <input
            id="search"
            name="search"
            type="search"
            defaultValue={filters.search ?? ""}
            placeholder="Name or SKU"
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="status"
            className="block text-sm font-medium text-ink"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={filters.status ?? ""}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
        >
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-ink/70">
          No products match this search.
        </p>
      ) : (
        <table className="mt-8 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/20">
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                Name
              </th>
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                SKUs
              </th>
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                Status
              </th>
              <th scope="col" className="py-2 font-medium text-ink">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-ink/10">
                <td className="py-2 pr-4 text-ink">{item.name}</td>
                <td className="py-2 pr-4 text-ink/80">
                  {item.skus.length > 0 ? item.skus.join(", ") : "—"}
                </td>
                <td className="py-2 pr-4 text-ink/80">{item.status}</td>
                <td className="py-2 text-ink/80">
                  <Link
                    href={`/admin/products/${item.id}/edit`}
                    aria-label={`Edit ${item.name}`}
                    className="text-lavender-dark hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
