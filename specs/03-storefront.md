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

| Param | Values | Notes |
|---|---|---|
| `category` | category slug, repeatable | multiple = OR within categories |
| `scent` | attribute value, repeatable | OR within scents |
| `size` | attribute value, repeatable | OR within sizes |
| `minPrice` / `maxPrice` | integer dollars | inclusive; compares against the variant price range |
| `inStock` | `true` | presence-only flag |
| `sort` | `newest` \| `price_asc` \| `price_desc` \| `name_asc` | default `newest` |
| `page` | integer >= 1 | default 1 |

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
- A product with multiple variants at different prices → matches if *any*
  variant falls in the range; displays "from $X"
- Sorting by price with variants → sort on the minimum active variant price
- Tie-break every sort on `id` so pagination is stable

### UI
- Mobile: filters in a bottom sheet behind a "Filter" button with an active count
- Desktop: sidebar
- Active filters shown as removable chips
- Filtered listing pages carry `noindex` (see SEO in fix_plan 2.6)

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
