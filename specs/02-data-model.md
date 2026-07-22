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
