import { listOrders } from "@/lib/repos/orders";
import { formatPriceCents } from "@/lib/format";
import {
  parseAdminOrderFilters,
  type RawSearchParams,
} from "@/lib/validation/admin-order-filters";
import { orderStatus } from "@/lib/db/schema";

// Orders change independently of deploys (AGENT.md: the database is the
// source of truth for catalog/inventory, and orders derive from it) — same
// rationale as every other DB-backed admin route (4.3b).
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = orderStatus.enumValues;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseAdminOrderFilters(await searchParams);
  const items = await listOrders(filters);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Orders</h1>

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
            placeholder="Order number or email"
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
        <p className="mt-8 text-sm text-ink/70">No orders match this search.</p>
      ) : (
        <table className="mt-8 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/20">
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                Order #
              </th>
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                Email
              </th>
              <th scope="col" className="py-2 pr-4 font-medium text-ink">
                Status
              </th>
              <th scope="col" className="py-2 font-medium text-ink">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-ink/10">
                <td className="py-2 pr-4 text-ink">{item.orderNumber}</td>
                <td className="py-2 pr-4 text-ink/80">{item.email}</td>
                <td className="py-2 pr-4 text-ink/80">{item.status}</td>
                <td className="py-2 text-ink/80">
                  {formatPriceCents(item.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
