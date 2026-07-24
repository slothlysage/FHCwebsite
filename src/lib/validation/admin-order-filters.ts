import { z } from "zod";

import { orderStatus } from "@/lib/db/schema";

// The admin Orders screen's search/status filter state (fix_plan 4.6a,
// specs/04-admin.md's "Orders — list (filter by status, search by order
// number or email)" line). Same URL-query-string shape as
// admin-product-filters.ts — no pagination/sort/facets here either, this is
// a small, single-owner order list, not a public-facing crawlable page.

export type AdminOrderStatusFilter = (typeof orderStatus.enumValues)[number];

export type AdminOrderFilters = {
  search: string | undefined;
  status: AdminOrderStatusFilter | undefined;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const statusSchema = z.enum(orderStatus.enumValues);
const searchSchema = z.string().trim().min(1);

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseAdminOrderFilters(
  raw: RawSearchParams,
): AdminOrderFilters {
  const searchResult = searchSchema.safeParse(firstValue(raw.search));
  const statusResult = statusSchema.safeParse(firstValue(raw.status));

  return {
    search: searchResult.success ? searchResult.data : undefined,
    status: statusResult.success ? statusResult.data : undefined,
  };
}
