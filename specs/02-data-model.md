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
stripe_price_id (nullable), is_active, allow_backorder (default true)`

Every product has at least one variant, even single-option products. This avoids
a whole class of "does this product have variants?" branching.

`allow_backorder` (added 2026-07-22): when true the variant stays purchasable
at zero or negative stock — the shop currently has no inventory and produces
to order, so it defaults on. Stock going negative is legal; the movements
ledger records the true position. The storefront shows such variants as
"Made to order" rather than "Out of stock", and the "In stock only" filter
stays literal (a made-to-order, zero-stock product does not match it).

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
unit_price_cents, quantity, line_total_cents, oversold_quantity (default 0)`

Snapshot the names and prices. An order must remain readable years after the
product is renamed or deleted. This is why `variant_id` is nullable.

`oversold_quantity` (added 2026-07-22): how many of `quantity` exceeded
on-hand stock at the moment the order was placed — the made-to-order/backorder
portion of the line. Checkout (phase 3) must compute it as
`max(0, quantity - available_stock)` at inventory-decrement time. 0 means the
line was fully covered by stock.

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

## Implementation notes (1.4b — diff + apply + seed CLI)

- `ParsedVariant` gained a `stockQuantity` field (parsed from the optional
  `Variant Inventory Qty` column, defaulting to `0` when absent or
  non-numeric — an unknown starting count is not a row-level parse error the
  way a missing price/weight is). 1.4a shipped without this field because
  nothing downstream needed it yet; 1.4b's "one `import`-reason
  `inventory_movements` row per variant" requirement is what needed it.
- `src/lib/services/catalog-import.ts` (new file, separate from
  `catalog-importer.ts`) does the DB-touching diff/apply. It reads the
  existing product by slug and each variant by SKU via the repos, decides
  `create`/`update`/`unchanged` per product and per variant, and — only in
  apply mode — writes. Category links and the full image set are
  re-applied on every apply run regardless of the product/variant diff
  action, which is what makes tag/image edits in a re-exported CSV take
  effect without a special-cased diff branch for them.
- **Transactionality vs. the "only repos import `db`" rule (AGENT.md):** a
  cross-table write (product + variants + category links + images +
  inventory movements) needs one shared transaction, but `db.transaction`
  itself must stay behind the repo boundary. Solved by adding a `DbExecutor`
  type export to `src/lib/db/client.ts` (`typeof db` or a `db.transaction`
  callback's `tx`) and an optional `executor: DbExecutor = db` parameter on
  every repo function `catalog-import.ts` calls
  (`products.createProduct`/`getProductBySlug`/`updateProduct`,
  `variants.createVariant`/`getVariantBySku`/`updateVariant`,
  `inventory.recordMovement`, and the new `categories.ts`/`images.ts`
  functions below). A new `src/lib/repos/transaction.ts` exports
  `withTransaction(fn)`, the only place outside `db/client.ts` that calls
  `db.transaction` directly — the service imports `withTransaction`, not
  `db`, so the dependency direction (`app → services → repos → db`) still
  holds. Dry-run mode calls the same code path with `executor` left
  `undefined`, which makes every repo call fall through to its own `= db`
  default — the service itself never imports `db`.
- Two new repo modules, mirroring the existing single-table-CRUD shape:
  - `src/lib/repos/categories.ts` — `getCategoryBySlug`, `createCategory`,
    `linkProductCategory` (inserts into `product_categories` with
    `.onConflictDoNothing()` — the composite PK makes re-linking an already-
    linked product/category pair a no-op instead of a unique-violation,
    which is what makes re-running an import idempotent for categories).
  - `src/lib/repos/images.ts` — `replaceProductImages(productId, images)`:
    deletes every existing row for the product, then bulk-inserts the new
    set. `product_images` has no natural unique key to upsert on (a
    reimported URL isn't guaranteed stable across runs), so delete-then-
    reinsert is what keeps the table from accumulating duplicates on
    repeated `--apply` runs.
- **Image `width`/`height` are written as `0`, not real dimensions.**
  `product_images.width`/`height` are `NOT NULL`, but Shopify's CSV export
  carries only `Image Src`/`Image Position`/`Image Alt Text` — no
  dimensions, since those require fetching and decoding the actual image
  bytes. That is 4.5's job (R2 presigned upload + magic-byte validation +
  EXIF stripping + responsive sizes), which will necessarily re-process
  every image anyway. `0`/`0` is a deliberate placeholder for 4.5 to
  overwrite, not a guess at real values.
- New variants created during apply always get exactly one `import`-reason
  `inventory_movements` row (delta = the parsed `stockQuantity`, even when
  it's `0`, for an unbroken audit trail). Variants that already existed
  (matched by SKU) never get a second movement on re-apply — the
  idempotency guarantee holds for stock, not just for the product/variant
  rows themselves.
- `scripts/import-catalog.mts` (not `.mjs`) — this CLI genuinely needs the
  tested TypeScript parser/diff/apply logic (unlike `db-migrate.mjs`, whose
  own logic is ten lines of raw `pg`/drizzle glue with nothing to reuse), so
  reimplementing it in plain JS was rejected as the exact duplicate-
  implementation trap the loop's own instructions warn about. Run via `tsx`
  (added as an explicit `devDependency`, previously present only
  transitively via `vite`/`drizzle-kit`). `.mts`, not `.ts`, because the
  script ends in a top-level `await main()` and the package has no
  `"type": "module"` — same reasoning as `vitest.config.mts` (0.2's NOTE).
  Usage: `npm run import-catalog -- <file.csv> [--apply]`.
- AC verified with a synthetic CSV against the local dev database (no real
  Shopify export exists yet — see "Blocked — needs human" in fix_plan.md):
  dry-run against an empty catalog reports every product/variant as
  `create` and writes nothing; `--apply` then creates the product, variant,
  category links, image, and exactly one `import` movement; running
  `--apply` again on the identical file reports everything `unchanged` and
  writes no new rows (confirmed no duplicate movement, image, or category
  link); changing a field and re-running reports/applies `update`; adding a
  new variant SKU to an already-imported product creates only that variant
  without touching the existing one's diff action or stock.
