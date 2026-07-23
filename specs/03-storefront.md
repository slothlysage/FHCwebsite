# 03 — Storefront

## Routes

```
/                         home — featured products, brand story
/products                 all products (sort + filter)
/products/[slug]          product detail
/collections/[slug]       category-scoped listing (reuses /products logic)
/cart
/checkout/success
/checkout/cancelled
/about /contact /faq /shipping /returns /privacy /terms
```

## Sort and filter — the detailed requirement

**State lives entirely in the URL.** No client-side state that a reload loses.
A customer must be able to send a friend a link to "8oz lavender candles under
$30, in stock, cheapest first."

Query parameters:

| Param                   | Values                                                | Notes                                               |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `category`              | category slug, repeatable                             | multiple = OR within categories                     |
| `scent`                 | attribute value, repeatable                           | OR within scents                                    |
| `size`                  | attribute value, repeatable                           | OR within sizes                                     |
| `minPrice` / `maxPrice` | integer dollars                                       | inclusive; compares against the variant price range |
| `inStock`               | `true`                                                | presence-only flag                                  |
| `sort`                  | `newest` \| `price_asc` \| `price_desc` \| `name_asc` | default `newest`                                    |
| `page`                  | integer >= 1                                          | default 1                                           |

Combination logic: different facets AND together, values within one facet OR
together. This is what shoppers expect and getting it backwards is the classic
bug.

Filtering happens **in SQL**, in one query, against published products only.
Do not fetch everything and filter in JavaScript — it breaks as soon as the
catalog grows and it breaks pagination immediately.

### Edge cases the tests must cover

- Unknown parameter values → ignored, not a 500
- `minPrice` > `maxPrice` → empty result with a clear message, not an error
- Zero results → "no products match" plus a working "clear filters" link
- A product with multiple variants at different prices → matches if _any_
  variant falls in the range; displays "from $X"
- Sorting by price with variants → sort on the minimum active variant price
- Tie-break every sort on `id` so pagination is stable

### UI

- Mobile: filters in a bottom sheet behind a "Filter" button with an active count
- Desktop: sidebar
- Active filters shown as removable chips
- Filtered listing pages carry `noindex` (see SEO in fix_plan 2.6)

## Implementation notes (2.3 — sort and filter)

- The whole filter/sort query is one SQL statement:
  `src/lib/repos/products.ts`'s `listPublishedProductsFiltered`. A LEFT JOIN
  to a per-product aggregate subquery over active variants supplies
  price-from (`min(price_cents)`) and in-stock (`bool_or(stock > 0)`, via
  the `variant_stock` view). Each active facet (category/scent/size) is a
  separate `EXISTS` condition — different facets AND together because
  they're independent `AND`ed conditions in the same `WHERE`; values within
  one facet OR together because the `EXISTS` subquery uses `IN (...)` for
  that facet's whole value list.
- Price range does **not** filter against the aggregated minimum price. It's
  its own `EXISTS` over `product_variants` checking whether _any_ active
  variant's price falls in `[minPriceCents, maxPriceCents]` — required
  because "matches if any variant falls in the range" (this file, above)
  is a different question than "is the cheapest variant in range." A
  `minPrice > maxPrice` range needs no special-cased "invalid, return
  empty" branch as a result: no variant can satisfy `price >= min AND
price <= max` when `min > max`, so the `EXISTS` is false for every
  product and the query naturally returns zero rows.
- `inStock` is presence-only (see the Notes column above) — the UI's
  checkbox either sends `inStock=true` or omits the param entirely, never
  `inStock=false`, so `src/lib/validation/product-filters.ts` treats any
  presence of the key as true. Don't "fix" this to check the value equals
  `"true"` without also changing the UI to send `false` explicitly.
- The filter UI (`src/components/product-filters-form.tsx`) is a plain
  `method="GET"` `<form>` with no client JS — every control change is a
  real navigation to a new `/products?...` URL, which is what makes state
  live in the URL by construction rather than by convention. The spec's
  "mobile bottom sheet / desktop sidebar" split was **not** implemented as
  two distinct layouts — a single `<details open>` disclosure is used at
  every width instead, since a true bottom-sheet overlay needs client JS
  (or risky duplicated form markup) that wasn't worth the scope increase
  for this task. See fix_plan.md 2.3's NOTE — this is an open follow-up,
  not a gap in the current AC.
- Facet options (which categories/scents/sizes even show up as checkboxes)
  come from `listFilterableCategories`/`listFilterableAttributeValues`,
  both scoped to published/non-deleted products — a facet value that only
  exists on a draft product never renders as a selectable-but-empty
  checkbox.
- `page` is in the query-param table above but not yet parsed anywhere —
  that's 2.4's job. `filtersToSearchParams` (the canonical filter→query-
  string serializer, used for chip/clear-filters links) is what 2.4 should
  extend for page-link hrefs, not replace.

## Implementation notes (2.4 — pagination)

- `ProductFilters.page` (1-based, default 1) lives in
  `src/lib/validation/product-filters.ts` alongside `PRODUCTS_PAGE_SIZE`
  (24). `filtersToSearchParams` omits `page` when it's 1, same convention as
  `sort` omitting `"newest"`.
- The repo (`listPublishedProductsFiltered`) does **not** take a `page`
  number — it takes raw `limit`/`offset`. The service layer
  (`getFilteredProductListing`) is what translates a page number into
  those, requesting `limit: PRODUCTS_PAGE_SIZE + 1` and slicing the extra
  row off to compute `hasNextPage` without a second COUNT query. This
  split exists because the peek needs a limit one row larger than the
  offset stride uses — a single "page size" value can't drive both without
  silently corrupting the offset math on `page >= 2` (hit and fixed during
  2.4; see fix_plan.md's NOTE for the exact failure). Any future pagination
  work should keep `limit`/`offset` as the repo's primitive and do
  page-number arithmetic one layer up.
- `ProductPagination` (`src/components/product-pagination.tsx`) is plain
  `<a>` links built from `filtersToSearchParams`, same no-JS-required
  philosophy as `ProductFiltersForm`. It renders nothing when there's only
  one page (no previous, no next).
- Integration tests that exercise real pagination (LIMIT/OFFSET boundaries,
  `hasNextPage`) scope their query to a throwaway category created just for
  that test, rather than relying on `toContain` against an unpaginated
  full-catalog result. The dev database is shared across concurrently-run
  vitest files; an unpaginated query is immune to whatever unrelated data
  exists elsewhere at that instant, but a LIMIT-24 query is not — a test's
  own product could get pushed off page 1 by another file's concurrently
  created products. Category-scoping (or, where that's not natural,
  accepting the cost of seeding `PRODUCTS_PAGE_SIZE + 1` rows) sidesteps
  this rather than making pagination tests flaky under parallel test
  execution.

## Product detail

Above the fold: image gallery, name, price (updates with variant), variant
selector, stock state, add to cart.
Below: description, ingredients (full INCI list), size/weight, burn time for
candles, safety warnings, care instructions, shipping summary.

Variant selection updates the URL (`?variant=sku`) so a specific variant is
linkable.

## Cart

Server-side, keyed by an httpOnly `cart_id` cookie. Never trust a client-held
cart. On every read, re-price line items from the database and re-clamp
quantities to available stock — then tell the user if something changed rather
than silently adjusting.

## Empty and error states

Every list has an empty state. Every async action has a pending state. Every
failure has a message that says what to do next, not "Something went wrong."
