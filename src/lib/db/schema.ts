import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// See specs/02-data-model.md — this file implements that spec exactly.
// All money is integer cents. All timestamps are timestamptz. All ids are
// uuid unless the spec says otherwise (order_number is a sequential integer).

export const productStatus = pgEnum("product_status", [
  "draft",
  "published",
  "archived",
]);
export const inventoryReason = pgEnum("inventory_reason", [
  "import",
  "sale",
  "refund",
  "adjustment",
  "damage",
]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const discountKind = pgEnum("discount_kind", ["percent", "fixed"]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    // Nullable at the DB level: cosmetics need an ingredient list and candles
    // need fire-safety warnings, but that's enforced at publish time by the
    // service layer, not by a NOT NULL constraint at insert time.
    ingredients: text("ingredients"),
    safetyInfo: text("safety_info"),
    careInfo: text("care_info"),
    status: productStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("products_status_created_at_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    weightGrams: integer("weight_grams").notNull(),
    position: integer("position").notNull().default(0),
    stripePriceId: text("stripe_price_id"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("product_variants_product_id_idx").on(table.productId),
    index("product_variants_sku_idx").on(table.sku),
  ],
);

export const productImages = pgTable("product_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  url: text("url").notNull(),
  altText: text("alt_text").notNull(),
  position: integer("position").notNull().default(0),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
});

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (table) => [primaryKey({ columns: [table.productId, table.categoryId] })],
);

// Open-ended filter facets (scent=lavender, size=8oz, ...) without a schema
// migration per new facet. Indexed on (key, value) per spec.
export const productAttributes = pgTable(
  "product_attributes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    index("product_attributes_product_id_idx").on(table.productId),
    index("product_attributes_key_value_idx").on(table.key, table.value),
  ],
);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    delta: integer("delta").notNull(),
    reason: inventoryReason("reason").notNull(),
    referenceId: uuid("reference_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id),
  },
  (table) => [index("inventory_movements_variant_id_idx").on(table.variantId)],
);

// Stock is never a column — current stock is SUM(delta) per variant,
// recomputed on every read so the ledger and the displayed count cannot
// diverge. A plain (non-materialized) view: always fresh, no trigger/refresh
// to keep in sync.
export const variantStock = pgView("variant_stock").as((qb) =>
  qb
    .select({
      variantId: inventoryMovements.variantId,
      // Cast to int4: postgres' sum(integer) is bigint by default, which
      // node-postgres returns as a string to avoid silent precision loss.
      // Stock deltas fit comfortably in int4 range.
      stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int`.as(
        "stock",
      ),
    })
    .from(inventoryMovements)
    .groupBy(inventoryMovements.variantId),
);

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  phone: text("phone"),
});

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    kind: discountKind("kind").notNull(),
    value: integer("value").notNull(),
    minSpendCents: integer("min_spend_cents"),
    maxUses: integer("max_uses"),
    timesUsed: integer("times_used").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    // Case-insensitive uniqueness: two codes differing only in case are the
    // same code.
    uniqueIndex("discount_codes_code_lower_idx").on(sql`lower(${table.code})`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Human-readable, sequential — a dedicated serial so it doesn't leak
    // insert order of any other table.
    orderNumber: serial("order_number").notNull().unique(),
    email: text("email").notNull(),
    status: orderStatus("status").notNull().default("pending"),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    shippingAddressId: uuid("shipping_address_id").references(
      () => addresses.id,
    ),
    billingAddressId: uuid("billing_address_id").references(() => addresses.id),
    discountCodeId: uuid("discount_code_id").references(() => discountCodes.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_created_at_idx").on(table.createdAt.desc()),
    index("orders_status_idx").on(table.status),
    index("orders_email_idx").on(table.email),
  ],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  // Nullable: a variant may later be deleted, but the order must remain
  // readable years after the product is renamed or removed — hence the
  // snapshot columns below.
  variantId: uuid("variant_id").references(() => productVariants.id),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  variantNameSnapshot: text("variant_name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotalCents: integer("line_total_cents").notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id),
  // Hash of the session token, never the token itself.
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const webhookEvents = pgTable("webhook_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: the admin who performed the action may later be deleted, but
  // the log is append-only and must retain the entry.
  adminUserId: uuid("admin_user_id").references(() => adminUsers.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
