import { z } from "zod";

import { productStatus } from "@/lib/db/schema";

// The admin Products screen's search/status filter state (fix_plan 4.3b,
// specs/04-admin.md's "Products — table with search, status filter" line).
// Lives in the URL query string like the storefront's own filter state
// (product-filters.ts), but there's no pagination/sort/facets here — this is
// a small, single-owner catalog list, not a public-facing crawlable page.

export type AdminProductStatusFilter =
  (typeof productStatus.enumValues)[number];

export type AdminProductFilters = {
  search: string | undefined;
  status: AdminProductStatusFilter | undefined;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const statusSchema = z.enum(productStatus.enumValues);
const searchSchema = z.string().trim().min(1);

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseAdminProductFilters(
  raw: RawSearchParams,
): AdminProductFilters {
  const searchResult = searchSchema.safeParse(firstValue(raw.search));
  const statusResult = statusSchema.safeParse(firstValue(raw.status));

  return {
    search: searchResult.success ? searchResult.data : undefined,
    status: statusResult.success ? statusResult.data : undefined,
  };
}
