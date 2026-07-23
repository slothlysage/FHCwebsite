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

## Implementation notes (2.5 — product detail)

- `src/lib/services/product-detail.ts`'s `getProductDetail(slug)` returns
  `null` — not a thrown error — for an unknown slug **and** for a slug that
  resolves to a draft/archived/soft-deleted product. The page's `notFound()`
  call doesn't distinguish the two cases, deliberately: a guessed URL for an
  unpublished product must 404 exactly like a nonexistent one, or the 404
  itself becomes a way to enumerate which slugs are "real but not live yet."
- There is no `burn_time` (or any other single-value candle/body-butter fact)
  column on `products`. It's a `product_attributes` row with `key =
"burn_time"`, the same open-ended mechanism 2.3 already uses for the
  `scent`/`size` filter facets — `getProductDetail` groups every attribute
  row for the product by key into `Record<string, string[]>` and the page
  only renders a "Burn time" field when `attributes.burn_time` is present.
  Any future single-fact display field should follow this pattern rather
  than adding a schema column.
- Variant selection is deliberately **not** wired through
  `next/navigation`'s `router.push`/`router.replace`. Doing so would
  re-fetch the page's RSC payload from the server on every change, which is
  exactly the "full reload" the AC forbids. Instead
  `src/components/variant-selector.tsx` (`"use client"`) keeps the selected
  variant in local React state (driving the displayed price/stock/shipping
  weight) and calls `window.history.replaceState` directly to keep the
  `?variant=sku` URL in sync for linkability, with no navigation at all.
- The variant `<select>` still lives inside a real `<form method="GET"
action="/products/[slug]">` with an always-visible "Update" submit
  button — same progressive-enhancement shape as `ProductFiltersForm`
  (2.3). With JS, the `onChange` handler makes the button redundant for the
  common case but it still works if clicked (a real GET navigation to
  `?variant=sku`, server-rendered by the page's own `searchParams` parsing).
  Without JS, that button is the only way to submit the selection — this is
  what makes the AC's "page works with JS disabled for the read-only
  content" true for variant switching too, not just the static text below
  the fold.
- The gallery (`src/components/product-gallery.tsx`) renders every image at
  once (primary large, rest as a thumbnail row) rather than a click-to-swap
  single-image viewer — a swappable main image needs client JS or
  duplicated/hidden markup, and nothing in 2.5's AC requires it. Revisit if
  a future task wants that interaction specifically.
- The "Add to cart" button exists now (disabled, `title="Cart is coming
soon"`) so 2.7 only has to attach behavior, not build layout. It's
  `type="button"`, not `type="submit"`, and lives outside the variant
  `<select>`'s own form so it won't fight that form's GET submission.

## Implementation notes (2.6b — Product/Offer JSON-LD)

- `src/lib/seo/product-json-ld.ts`'s `buildProductJsonLd` is pure (no DB, no
  Next imports) — it takes an already-fetched `ProductDetail`, the currently
  selected SKU, and an absolute `siteUrl`, and returns a plain object or
  `null`. The page (`products/[slug]/page.tsx`) is the only caller and is
  responsible for `JSON.stringify`-ing it into a `<script
type="application/ld+json">` via `dangerouslySetInnerHTML`.
- Returns `null` — the page renders no script tag at all — when
  `detail.images` is empty or the product has no variants. schema.org's
  `Product`/`Offer` types require `image` and `offers`; emitting JSON-LD that
  fails required-field validation is worse than omitting the block entirely.
- `availability` is 3-way, not the usual InStock/OutOfStock binary:
  `stock > 0` → `InStock`; `stock <= 0 && allowBackorder` → `BackOrder` (a
  real schema.org `ItemAvailability` value); otherwise `OutOfStock`. This
  exists because of 1.7's made-to-order/oversell support — a zero-stock,
  backorderable variant shows "Made to order" in the UI, and structured data
  claiming `OutOfStock` for the same variant would contradict it.
- `Offer.price` is a bare decimal string (`(cents / 100).toFixed(2)`, e.g.
  `"24.00"`), not `format.ts`'s `formatPriceCents` (`"$24.00"`) — schema.org
  wants a currency-free number string, with `priceCurrency` as the separate
  `"USD"` field.
- `Offer.url` is the same canonical shape 2.6a's `generateMetadata` already
  uses (`/products/{slug}`, absolute via `siteUrl`, no `?variant=`) — the
  variant selector is UI state on one resource, not a distinct page, so
  every variant of a product shares one canonical/URL regardless of which
  one is initially selected.

## Implementation notes (2.6d — OG images)

- Two Next file-convention special files, not a hand-rolled route manually
  wired into `generateMetadata`'s `openGraph.images`: `src/app/
opengraph-image.tsx` (static default — applies to every route by
  inheritance, including `/`, `/products`, and any future content page)
  and `src/app/(storefront)/products/[slug]/opengraph-image.tsx` (dynamic
  override for exactly that segment). Next resolves the file into each
  page's metadata automatically and per-segment — no manual
  `openGraph.images` code needed in either `generateMetadata`.
- Both cards are **text-only** — brand name/tagline for the default,
  product name + "from $X" (lowest active-variant price) for the product
  card. No product photo is composited in, because real product/brand
  photography doesn't exist yet (see this repo's `fix_plan.md` "Blocked"
  section) and `product_images.url` values from the CSV importer aren't
  guaranteed reachable/right-sized for satori (the renderer behind
  `next/og`'s `ImageResponse`) to fetch remotely mid-render. Swap in a real
  photo (e.g. `detail.images[0]`) once that asset exists — don't re-derive
  "the primary image" a third way, `product-json-ld.ts`'s NOTE already
  flags this same image list as the one to reuse.
- The product card fetches `getProductDetail(slug)` and falls back to a
  generic "Handmade goods" card (no price line) for anything that isn't a
  live published product — unknown, draft, archived, or soft-deleted slug,
  or a published product with zero active variants. This mirrors
  `product-detail.ts`'s own `null`-for-unpublished contract: a stale or
  guessed link must not leak an unpublished product's real name via its
  social-preview image, and the route must never throw (a thrown OG image
  handler surfaces as a broken image to the crawler/chat client requesting
  it, not a 404).
- **Vitest gotcha**: `next/og`'s `ImageResponse` rasterizes via `sharp` on
  the Node runtime. Under this project's default `environment: "jsdom"`
  (`vitest.config.mts`), `sharp` throws `Unsupported input ... of type
object` — jsdom's `Buffer`/`Uint8Array` aren't the same realm/constructor
  `sharp`'s `instanceof` checks expect. Both OG image test files start with
  a `// @vitest-environment node` docblock (Vitest's documented per-file
  override) instead of changing the project-wide default, which every
  other test file still needs for RTL/axe. Any future test that actually
  invokes `ImageResponse` (rather than mocking `next/og`) needs the same
  docblock.

## Cart

Server-side, keyed by an httpOnly `cart_id` cookie. Never trust a client-held
cart. On every read, re-price line items from the database and re-clamp
quantities to available stock — then tell the user if something changed rather
than silently adjusting.

### Implementation notes (2.7b, `src/lib/services/cart.ts`)

- `getCartSummary(cartId)` is the single read path: re-joins live
  `product_variants` for price/stock on every call, persists any clamp or
  removal it finds back to `cart_items`, and returns them in an
  `adjustments: CartAdjustment[]` array (`removed` / `quantity_reduced`) —
  this array _is_ "tell the user something changed," not a side channel the
  UI has to compute itself.
- One clamp rule for the whole cart, not per-caller: made-to-order variants
  (`allowBackorder`, see 1.7) have no upper bound; everything else clamps to
  live stock, floor zero. Zero-or-below after clamping means the line is
  dropped, not left as a zero-quantity row.
- A variant is only purchasable if it's active AND its product is
  `published` and not soft-deleted — same contract `product-detail.ts` (2.5)
  already enforces. A cart line for a variant/product that falls out of
  that contract (deactivated, unpublished, deleted) is dropped and reported
  the same way a stock-out is.
- `addToCart` **increments** the existing line's quantity; `updateCartItemQuantity`
  **sets** an absolute quantity (and removes the line at `<= 0`). This split
  exists because `cart_items`' repo-level `upsertCartItem` (2.7a) only ever
  sets an exact value — the service owns the "add more" vs. "set to N"
  decision, the repo does not.
- 3.5 (checkout) should call `getCartSummary` for its line totals rather than
  re-deriving pricing/stock a third way — it's the same "prices computed
  server-side" rule AGENT.md states for order totals.

### Implementation notes (2.7c, cart UI + cookie wiring)

- `src/lib/cart-cookie.ts` is the only module that imports `next/headers`.
  `readCartId()` is read-only (safe from Server Components — the header and
  the cart page both call it and never create a cart on a plain page load).
  `writeCartId()` mutates the `Set-Cookie` header and only actually works
  when called from a Server Action/Route Handler; Next enforces that at
  runtime, not in the type system (`ReadonlyRequestCookies` still types
  `.set`/`.delete` because they're needed by the mutable-context caller).
- `src/lib/actions/cart.ts` — three Server Actions (`addToCartAction`,
  `updateCartItemAction`, `removeCartItemAction`), one per cart mutation.
  Deliberately placed under `lib/`, not `app/`: `VariantSelector`
  (`src/components/variant-selector.tsx`) is a component and needs to import
  the add-to-cart action directly, and components importing from `app/`
  would invert AGENT.md's dependency direction. Each action parses its
  `FormData` through `src/lib/validation/cart-form.ts` (zod, permissive —
  same "malformed/missing → safe default, never throw" convention as
  `product-filters.ts`; an invalid `variantId` makes the whole action a
  no-op) before calling `getOrCreateCartId()` (reads the cookie, verifies
  the cart it names still exists via `getCartById`, otherwise creates one
  via `createCart` — the 2.7a NOTE's "createCart is the repo's job, called
  directly by 2.7c" is implemented literally here) and then the
  corresponding `lib/services/cart.ts` function. Every action finishes with
  `revalidatePath("/", "layout")` since the header's cart count is rendered
  on every route via the root layout, not just `/cart`.
- Progressive enhancement is Next's Server Actions mechanism itself, not a
  hand-rolled GET-form pattern like `ProductFiltersForm`/`VariantSelector`'s
  own variant-picker: a `<form action={someServerAction}>` renders a real
  `method="POST"` HTML form with a hidden `$ACTION_ID_...` field, so it
  submits and works even with client JS disabled — verified live against a
  running `next dev` server with raw `curl -F` POSTs (no browser JS
  involved) reproducing the exact hidden-field set Next renders: add →
  `cart_id` cookie set + header count updated; quantity update → subtotal
  recalculated; remove → cart empties and header returns to 0.
- `SiteHeader` (`src/components/site-header.tsx`) is now an async Server
  Component: `readCartId()` then, if present, `getCartSummary(cartId).lines`
  summed by quantity. No cart cookie yet reads as 0, not an error state.
  Because it's rendered in the root layout on every route, and it calls
  `cookies()`, **every route in the app is now dynamically rendered** — confirmed
  via `next build`'s route table: `/` (still 0.1's placeholder pending 2.9)
  and `/_not-found` both flipped from `○` to `ƒ`. `/opengraph-image` and
  `/robots.txt` are unaffected (Next's metadata-route files don't render the
  page/layout JSX tree at all, so they never call the header).
  `SiteHeader` is invoked directly and awaited in its own tests
  (`render(await SiteHeader())`), same pattern as every async
  Server Component page test in this repo.
- Cart page (`src/app/(storefront)/cart/page.tsx`): renders
  `getCartSummary`'s `adjustments` as a `role="status"` list above the line
  items (the literal "tell the user something changed" UI, 2.7b already did
  the hard part), each line's own quantity `<form>`/remove `<form>`, and the
  spec's required empty state ("Your cart is empty." + a link to
  `/products`) when there are no lines — including the case where every line
  got dropped by a same-request adjustment (a fully-clamped-to-nothing cart
  shows both the adjustment message and the empty state, not a stale line).
- Not built in this task, flagged for whoever needs it: no client-side
  pending/loading indicator (e.g. `useFormStatus`) on any of the three
  forms. Browsers show their own native "submitting" affordance for a real
  form POST regardless, so nothing is silently broken — but the spec's
  general "every async action has a pending state" rule isn't fully met by
  a plain submit button. Revisit if checkout (phase 3) or a future pass
  wants a nicer in-page spinner.

## Empty and error states

Every list has an empty state. Every async action has a pending state. Every
failure has a message that says what to do next, not "Something went wrong."

## Implementation notes (2.9 — home page)

The route table's `/` line calls for "featured products, brand story" — only
the featured-products half is built; the brand-story narrative is a human
gate (real marketing/about-the-maker copy, not placeholder text — see
fix_plan.md's "Blocked — needs human").

`getFeaturedProductListing(limit)` (`src/lib/services/product-listing.ts`) is
the newest-first, unfiltered, non-paginated sibling of `getFilteredProductListing`
— reuse it for any future "N most recent published products" need (e.g. a
"New arrivals" section) rather than re-deriving the query. It intentionally
has no `hasNextPage`/facet support; that's what `getFilteredProductListing`
is for.
