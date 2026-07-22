# 02 — Data model

All money is `integer` **cents**. All timestamps are `timestamptz`. All ids are
`uuid` unless noted.

## products

`id, slug (unique), name, description, ingredients, safety_info, care_info,
status ('draft'|'published'|'archived'), created_at, updated_at, deleted_at`

`ingredients` and `safety_info` are not optional in practice — cosmetics require
an ingredient list and candles require fire-safety warnings. Enforce at publish
time, not at insert time.

## product_variants

`id, product_id → products, sku (unique), name (e.g. "8oz — Lavender"),
price_cents, compare_at_price_cents (nullable), weight_grams, position,
stripe_price_id (nullable), is_active`

Every product has at least one variant, even single-option products. This avoids
a whole class of "does this product have variants?" branching.

## product_images

`id, product_id, url, alt_text (NOT NULL), position, width, height`

## categories / product_categories

`categories: id, slug (unique), name, description`
`product_categories: product_id, category_id` (composite PK)

## Attributes for filtering

`product_attributes: product_id, key, value` — e.g. `scent=lavender`,
`size=8oz`. Indexed on `(key, value)`. Keeps the filter system open-ended
without schema migrations per new facet.

## inventory_movements

`id, variant_id, delta (integer, signed), reason ('import'|'sale'|'refund'|
'adjustment'|'damage'), reference_id (nullable), note, created_at, created_by`

**Stock is never a column.** Current stock is `SUM(delta)` per variant,
materialized into a view or cached column updated only by trigger. This makes
the ledger authoritative and makes discrepancies impossible rather than merely
unlikely.

## orders

`id, order_number (human-readable, sequential), email, status ('pending'|
'paid'|'fulfilled'|'cancelled'|'refunded'|'partially_refunded'),
subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents,
currency, stripe_session_id (unique), stripe_payment_intent_id,
shipping_address_id, billing_address_id, discount_code_id, notes,
created_at, paid_at, fulfilled_at`

## order_items

`id, order_id, variant_id (nullable — variant may later be deleted),
product_name_snapshot, variant_name_snapshot, sku_snapshot,
unit_price_cents, quantity, line_total_cents`

Snapshot the names and prices. An order must remain readable years after the
product is renamed or deleted. This is why `variant_id` is nullable.

## addresses

`id, name, line1, line2, city, region, postal_code, country, phone`

## admin_users

`id, email (unique), password_hash (argon2id), totp_secret (nullable),
last_login_at, failed_attempts, locked_until, created_at`

## sessions

`id, admin_user_id, token_hash, expires_at, created_at, ip, user_agent,
revoked_at`

Store a hash of the session token, never the token.

## webhook_events

`stripe_event_id (PK), type, received_at, processed_at, payload jsonb`

Insert-then-process. A unique-violation on insert means "already seen" — return
200 and stop. This is the whole idempotency mechanism.

## discount_codes

`id, code (unique, case-insensitive), kind ('percent'|'fixed'),
value, min_spend_cents, max_uses, times_used, starts_at, ends_at, is_active`

## audit_log

`id, admin_user_id, action, entity_type, entity_id, before jsonb, after jsonb,
created_at` — append-only.

## Indexes to create explicitly

- `products (status, created_at desc)`
- `product_variants (product_id)`, `product_variants (sku)`
- `product_attributes (key, value)`
- `orders (created_at desc)`, `orders (status)`, `orders (email)`
- `inventory_movements (variant_id)`

## Implementation notes (1.1)

- No standalone `customers` table exists, despite the fix_plan's task bullet
  naming one — this spec never defined one, and `orders.email` +
  `addresses` cover v1. If repeat-customer accounts are needed later, add a
  `customers` table to this spec first, then migrate; don't let a future
  iteration infer one from the fix_plan wording alone.
- `variant_stock` (the "stock is `SUM(delta)`" requirement) is implemented
  as a plain Postgres view (`drizzle-orm`'s `pgView`), not a materialized
  view: `SELECT variant_id, coalesce(sum(delta), 0)::int AS stock FROM
inventory_movements GROUP BY variant_id`. A plain view recomputes on every
  read, so it's always correct with nothing to refresh — stronger than a
  materialized view for this size of table. The `::int` cast matters:
  Postgres' `sum(integer)` is `bigint`, and `pg`/node-postgres returns
  `bigint` columns as strings to avoid silent precision loss, which the
  view's consumers don't expect from a value called `stock`.
- A variant with zero inventory movements has **no row** in `variant_stock`
  (an inner-join-shaped `GROUP BY`, not `LEFT JOIN`) — treat a missing row as
  zero stock, don't treat it as "not found."
- `discount_codes.code` case-insensitivity is a `uniqueIndex` on
  `lower(code)`, not a `citext` column — avoids the extension dependency;
  application code must still compare/normalize with `lower()`.
- `orders.order_number` is a Drizzle `serial` (its own Postgres sequence),
  deliberately not derived from any other table's row count, so it can't
  leak insert-order information about anything else.

## Implementation notes (1.3c — inventory repo)

- `src/lib/repos/inventory.ts`'s `getStockForVariants` (batch stock lookup)
  pre-seeds a `Map` with `0` for every requested variant id, then overwrites
  entries from `variant_stock`'s rows. Callers get a value for every id they
  asked for, never a missing key — the "zero rows = zero stock" rule from
  above is handled once in the repo, not by every caller re-deriving it from
  `variant_stock`'s inner-join-shaped `GROUP BY`.
- Drizzle's `inArray(col, ids)` compiles to `col IN (...)`; called with an
  empty array it compiles to `IN ()`, which Postgres rejects as a syntax
  error. `getStockForVariants` special-cases `ids.length === 0` and returns
  an empty `Map` without querying. Any future batch-lookup function built on
  `inArray` (e.g. an orders or variants batch fetch) needs the same guard.

## Implementation notes (1.3d — orders repo)

- `src/lib/repos/orders.ts`'s `createOrder(order, items)` wraps the order
  insert and the `order_items` insert in one `db.transaction`, matching the
  "atomic, no partial rows" requirement 3.5 will also depend on. Drizzle's
  transaction callback rolls back automatically on any thrown error inside
  it — including a Postgres constraint violation from the driver — so no
  explicit `tx.rollback()` call is needed for this case.
- `order_items.variant_id` is nullable (a variant may be deleted later; see
  the snapshot-column rationale above), so Postgres only enforces the FK
  when a value is actually supplied. A test proving transactional rollback
  must therefore pass a non-null-but-nonexistent variant id — passing `null`
  inserts successfully and proves nothing.
- No order-items reader (e.g. `getOrderItemsByOrderId`) exists yet. The
  fix_plan's 1.3d bullet only calls for order-level functions
  (create/getById/getByStripeSessionId/listByStatus/update). 3.5 (order
  creation + inventory decrement) and 4.6 (orders dashboard) will need one —
  add it there against their actual read shape, rather than guessing one now.

## Implementation notes (1.4a — CSV catalog importer, parse stage)

- `src/lib/services/catalog-importer.ts`'s `parseShopifyCsv` targets
  Shopify's standard product CSV export column layout directly (`Handle`,
  `Title`, `Body (HTML)`, `Tags`, `Option1/2/3 Value`, `Variant SKU`,
  `Variant Price`, `Variant Compare At Price`, `Variant Grams`, `Image Src`,
  `Image Position`, `Image Alt Text`) — there is no repo-specific CSV spec to
  diverge from, so this is the format to keep matching if Shopify changes it.
- `product_variants.weight_grams` is `NOT NULL` with no `.default()`, so
  `Variant Grams` is a required column for the importer even though nothing
  above marks it required for other reasons — a row that parses fine
  otherwise but has a non-numeric/blank grams value is rejected at the row
  level, not coerced to `0`.
- Parsed output has no `productId`/`variantId`/`categoryId` — this stage
  never touches the database (no `db` import), by design, so it's cheap to
  unit test exhaustively. 1.4b is responsible for diffing parsed slugs/SKUs
  against `products`/`product_variants` and creating `categories` rows for
  any `ParsedProduct.categories` string that doesn't already have a matching
  `categories.slug`.
