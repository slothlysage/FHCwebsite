import { z } from "zod";

// The storefront listing's entire filter/sort state — see
// specs/03-storefront.md's "Sort and filter" section. State lives in the URL
// query string, never in client-side state, so this module's job is turning
// that untrusted string map into a typed, defaulted shape. Every field is
// permissive: an unknown or malformed value is dropped/defaulted, never an
// error — "unknown parameter values -> ignored, not a 500" per spec.

export const PRODUCT_SORT_VALUES = [
  "newest",
  "price_asc",
  "price_desc",
  "name_asc",
] as const;
export type ProductSort = (typeof PRODUCT_SORT_VALUES)[number];

const DEFAULT_SORT: ProductSort = "newest";
const DEFAULT_PAGE = 1;

// Products per listing page. Shared by the repo's LIMIT/OFFSET and the
// service's next-page lookahead (fetches one extra row past this size to
// decide `hasNextPage` without a separate COUNT query) — see fix_plan 2.4.
export const PRODUCTS_PAGE_SIZE = 24;

export type ProductFilters = {
  categorySlugs: string[];
  scents: string[];
  sizes: string[];
  minPriceCents: number | undefined;
  maxPriceCents: number | undefined;
  inStockOnly: boolean;
  sort: ProductSort;
  page: number;
};

// Next's App Router gives a single string for a param that appears once and
// a string[] for one that's repeated (?category=a&category=b).
export type RawSearchParams = Record<string, string | string[] | undefined>;

const sortSchema = z.enum(PRODUCT_SORT_VALUES);
const pageSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());
const facetValueSchema = z.string().trim().min(1);
// Whole or fractional dollars in the URL; stored internally as integer
// cents, matching AGENT.md's money rule.
const dollarsToCentsSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative())
  .transform((dollars) => Math.round(dollars * 100));

function toValueArray(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseFacetValues(raw: string | string[] | undefined): string[] {
  const values: string[] = [];
  for (const candidate of toValueArray(raw)) {
    const result = facetValueSchema.safeParse(candidate);
    if (result.success && !values.includes(result.data)) {
      values.push(result.data);
    }
  }
  return values;
}

function parsePriceCents(
  raw: string | string[] | undefined,
): number | undefined {
  const result = dollarsToCentsSchema.safeParse(firstValue(raw));
  return result.success ? result.data : undefined;
}

function parseSort(raw: string | string[] | undefined): ProductSort {
  const result = sortSchema.safeParse(firstValue(raw));
  return result.success ? result.data : DEFAULT_SORT;
}

function parsePage(raw: string | string[] | undefined): number {
  const result = pageSchema.safeParse(firstValue(raw));
  return result.success ? result.data : DEFAULT_PAGE;
}

export function parseProductFilters(raw: RawSearchParams): ProductFilters {
  return {
    categorySlugs: parseFacetValues(raw.category),
    scents: parseFacetValues(raw.scent),
    sizes: parseFacetValues(raw.size),
    minPriceCents: parsePriceCents(raw.minPrice),
    maxPriceCents: parsePriceCents(raw.maxPrice),
    // "Values: true / Notes: presence-only flag" (specs/03-storefront.md) —
    // the UI only ever sends `inStock=true` or omits the param entirely, so
    // presence is the whole signal, not the value's content.
    inStockOnly: raw.inStock !== undefined,
    sort: parseSort(raw.sort),
    page: parsePage(raw.page),
  };
}

// The inverse of parseProductFilters: turns a normalized filter set back
// into a canonical query string. Used to build filter-chip removal links,
// sort links, and the "clear filters" link without ever hand-assembling a
// query string outside this module.
export function filtersToSearchParams(
  filters: ProductFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const slug of filters.categorySlugs) params.append("category", slug);
  for (const scent of filters.scents) params.append("scent", scent);
  for (const size of filters.sizes) params.append("size", size);
  if (filters.minPriceCents !== undefined) {
    params.set("minPrice", String(filters.minPriceCents / 100));
  }
  if (filters.maxPriceCents !== undefined) {
    params.set("maxPrice", String(filters.maxPriceCents / 100));
  }
  if (filters.inStockOnly) params.set("inStock", "true");
  if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  if (filters.page !== DEFAULT_PAGE) params.set("page", String(filters.page));
  return params;
}
