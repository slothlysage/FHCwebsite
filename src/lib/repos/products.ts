import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db/client";
import {
  categories,
  productAttributes,
  productCategories,
  products,
  productVariants,
  variantStock,
} from "@/lib/db/schema";
import type { ProductSort } from "@/lib/validation/product-filters";

type Product = typeof products.$inferSelect;
type NewProduct = typeof products.$inferInsert;
type ProductStatus = Product["status"];

export async function createProduct(
  input: NewProduct,
  executor: DbExecutor = db,
): Promise<Product> {
  const [product] = await executor.insert(products).values(input).returning();
  return product!;
}

export async function getProductById(id: string): Promise<Product | undefined> {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product;
}

export async function getProductBySlug(
  slug: string,
  executor: DbExecutor = db,
): Promise<Product | undefined> {
  const [product] = await executor
    .select()
    .from(products)
    .where(eq(products.slug, slug));
  return product;
}

export async function listProducts(options?: {
  status?: ProductStatus;
  includeDeleted?: boolean;
  // Admin products-list search (4.3b): matches a case-insensitive substring
  // of either the product name or any of its variants' SKUs — a shop owner
  // looking a product up rarely knows which of the two they have on hand.
  search?: string;
}): Promise<Product[]> {
  const conditions = [];
  if (options?.status) {
    conditions.push(eq(products.status, options.status));
  }
  if (!options?.includeDeleted) {
    conditions.push(isNull(products.deletedAt));
  }
  if (options?.search) {
    const pattern = `%${options.search}%`;
    conditions.push(
      or(
        ilike(products.name, pattern),
        exists(
          db
            .select({ one: sql`1` })
            .from(productVariants)
            .where(
              and(
                eq(productVariants.productId, products.id),
                ilike(productVariants.sku, pattern),
              ),
            ),
        ),
      ),
    );
  }

  return db
    .select()
    .from(products)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(products.createdAt));
}

export async function updateProduct(
  id: string,
  patch: Partial<NewProduct>,
  executor: DbExecutor = db,
): Promise<Product | undefined> {
  const [updated] = await executor
    .update(products)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return updated;
}

export async function softDeleteProduct(
  id: string,
  executor: DbExecutor = db,
): Promise<Product | undefined> {
  const [deleted] = await executor
    .update(products)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return deleted;
}

export type ProductListFilters = {
  categorySlugs?: string[];
  scents?: string[];
  sizes?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  sort?: ProductSort;
  // Raw LIMIT/OFFSET, deliberately not a `page` number — the service layer
  // owns translating a 1-based page into these (and fetches one extra row
  // past the real page size to compute `hasNextPage` without a separate
  // COUNT query, which is exactly why offset and limit can't be derived
  // from the same "page size" value). Omitting `limit` returns every match,
  // unpaginated — existing callers that never set it keep that behavior.
  // Still tie-broken on id so page boundaries stay stable regardless of
  // sort column (specs/03-storefront.md).
  limit?: number;
  offset?: number;
};

export type FilteredProduct = Product & {
  priceFromCents: number | null;
  inStock: boolean;
  // Purchasable = any active variant with stock OR allow_backorder — a
  // made-to-order product is sellable at zero stock without counting as
  // "in stock" (the badge and the "In stock only" filter stay literal).
  purchasable: boolean;
};

// One EXISTS-per-facet condition: `products.id` matches if the product has
// at least one product_attributes row for `key` whose value is one of
// `values` — the OR-within-a-facet half of specs/03-storefront.md's
// "different facets AND together, values within one facet OR together".
function attributeValueExists(key: string, values: string[]): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(productAttributes)
      .where(
        and(
          eq(productAttributes.productId, products.id),
          eq(productAttributes.key, key),
          inArray(productAttributes.value, values),
        ),
      ),
  );
}

// Published, non-deleted products matching every supplied filter (AND across
// facets, OR within a facet), sorted per `filters.sort`, tie-broken on id so
// pagination (2.4) stays stable. Filtering happens entirely in this one
// query — see specs/03-storefront.md: "Filtering happens in SQL... Do not
// fetch everything and filter in JavaScript."
export async function listPublishedProductsFiltered(
  filters: ProductListFilters = {},
): Promise<FilteredProduct[]> {
  // Per-product aggregate over active variants: the lowest price (what the
  // card's "from $X" and price sort use) and whether any active variant has
  // positive stock. A plain LEFT JOIN subquery, not a second round-trip —
  // a product with zero active variants gets NULL for both, which the
  // mapping below turns into `null`/`false`, matching 2.2's contract.
  const variantAgg = db
    .select({
      productId: productVariants.productId,
      priceFromCents: sql<number>`min(${productVariants.priceCents})`.as(
        "price_from_cents",
      ),
      inStock: sql<boolean>`bool_or(coalesce(${variantStock.stock}, 0) > 0)`.as(
        "in_stock",
      ),
      purchasable:
        sql<boolean>`bool_or(coalesce(${variantStock.stock}, 0) > 0 or ${productVariants.allowBackorder})`.as(
          "purchasable",
        ),
    })
    .from(productVariants)
    .leftJoin(variantStock, eq(variantStock.variantId, productVariants.id))
    .where(eq(productVariants.isActive, true))
    .groupBy(productVariants.productId)
    .as("variant_agg");

  const conditions: SQL[] = [
    eq(products.status, "published"),
    isNull(products.deletedAt),
  ];

  if (filters.categorySlugs?.length) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(productCategories)
          .innerJoin(
            categories,
            eq(productCategories.categoryId, categories.id),
          )
          .where(
            and(
              eq(productCategories.productId, products.id),
              inArray(categories.slug, filters.categorySlugs),
            ),
          ),
      ),
    );
  }

  if (filters.scents?.length) {
    conditions.push(attributeValueExists("scent", filters.scents));
  }

  if (filters.sizes?.length) {
    conditions.push(attributeValueExists("size", filters.sizes));
  }

  if (
    filters.minPriceCents !== undefined ||
    filters.maxPriceCents !== undefined
  ) {
    // "Matches if any variant falls in the range" (spec) — deliberately not
    // filtered against the aggregated minimum price above, since a
    // multi-variant product can have one variant inside the range and a
    // cheaper one outside it. A minPrice > maxPrice range can never be
    // satisfied by any variant, so this naturally produces zero rows
    // instead of needing a special-cased "invalid range" branch.
    const priceConditions = [
      eq(productVariants.productId, products.id),
      eq(productVariants.isActive, true),
    ];
    if (filters.minPriceCents !== undefined) {
      priceConditions.push(
        gte(productVariants.priceCents, filters.minPriceCents),
      );
    }
    if (filters.maxPriceCents !== undefined) {
      priceConditions.push(
        lte(productVariants.priceCents, filters.maxPriceCents),
      );
    }
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(productVariants)
          .where(and(...priceConditions)),
      ),
    );
  }

  if (filters.inStockOnly) {
    conditions.push(eq(variantAgg.inStock, true));
  }

  const orderBy = (() => {
    switch (filters.sort) {
      case "price_asc":
        return [asc(variantAgg.priceFromCents), asc(products.id)];
      case "price_desc":
        return [desc(variantAgg.priceFromCents), asc(products.id)];
      case "name_asc":
        return [asc(products.name), asc(products.id)];
      case "newest":
      default:
        return [desc(products.createdAt), asc(products.id)];
    }
  })();

  const baseQuery = db
    .select({
      product: products,
      priceFromCents: variantAgg.priceFromCents,
      inStock: variantAgg.inStock,
      purchasable: variantAgg.purchasable,
    })
    .from(products)
    .leftJoin(variantAgg, eq(variantAgg.productId, products.id))
    .where(and(...conditions))
    .orderBy(...orderBy);

  const rows =
    filters.limit !== undefined
      ? await baseQuery.limit(filters.limit).offset(filters.offset ?? 0)
      : await baseQuery;

  return rows.map((row) => ({
    ...row.product,
    priceFromCents: row.priceFromCents ?? null,
    inStock: row.inStock ?? false,
    purchasable: row.purchasable ?? false,
  }));
}
