import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  addresses,
  adminUsers,
  auditLog,
  categories,
  discountCodes,
  inventoryMovements,
  orderItems,
  orders,
  productAttributes,
  productCategories,
  productImages,
  productVariants,
  products,
  sessions,
} from "@/lib/db/schema";

// Regression tests for specs/02-data-model.md's "Indexes to create
// explicitly" list, and for every `.references(() => otherTable.col)` target.
// Both a table's `extraConfig` callback (indexes, composite PKs, unique
// constraints) and a foreign key's target-table thunk are lazily invoked —
// only by drizzle-kit or `getTableConfig`/`.reference()`, never by ordinary
// query building — so nothing else in the suite exercises this code. These
// tests both prove the spec's constraints exist (so a future edit that drops
// one fails the suite) and give that lazily-evaluated code a real caller.

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function fkTargets(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map(
    (fk) => fk.reference().foreignTable,
  );
}

describe("explicit indexes", () => {
  it("products has a (status, created_at desc) index", () => {
    expect(indexNames(products)).toContain("products_status_created_at_idx");
  });

  it("product_variants has product_id and sku indexes", () => {
    const names = indexNames(productVariants);
    expect(names).toContain("product_variants_product_id_idx");
    expect(names).toContain("product_variants_sku_idx");
  });

  it("product_attributes is indexed on product_id and on (key, value)", () => {
    const names = indexNames(productAttributes);
    expect(names).toContain("product_attributes_product_id_idx");
    expect(names).toContain("product_attributes_key_value_idx");
  });

  it("inventory_movements is indexed on variant_id", () => {
    expect(indexNames(inventoryMovements)).toContain(
      "inventory_movements_variant_id_idx",
    );
  });

  it("orders is indexed on created_at desc, status, and email", () => {
    const names = indexNames(orders);
    expect(names).toContain("orders_created_at_idx");
    expect(names).toContain("orders_status_idx");
    expect(names).toContain("orders_email_idx");
  });

  it("discount_codes has a case-insensitive unique index on code", () => {
    const config = getTableConfig(discountCodes);
    const codeIndex = config.indexes.find(
      (index) => index.config.name === "discount_codes_code_lower_idx",
    );
    expect(codeIndex?.config.unique).toBe(true);
  });

  it("product_categories has a composite primary key on (product_id, category_id)", () => {
    const config = getTableConfig(productCategories);
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(
      ["product_id", "category_id"],
    );
  });
});

describe("foreign key targets", () => {
  it("orders references addresses (shipping, billing) and discount_codes", () => {
    const targets = fkTargets(orders);
    expect(targets.filter((table) => table === addresses)).toHaveLength(2);
    expect(targets).toContain(discountCodes);
  });

  it("order_items references orders and product_variants", () => {
    const targets = fkTargets(orderItems);
    expect(targets).toContain(orders);
    expect(targets).toContain(productVariants);
  });

  it("sessions references admin_users", () => {
    expect(fkTargets(sessions)).toContain(adminUsers);
  });

  it("audit_log references admin_users", () => {
    expect(fkTargets(auditLog)).toContain(adminUsers);
  });

  it("product_variants references products", () => {
    expect(fkTargets(productVariants)).toContain(products);
  });

  it("product_images references products", () => {
    expect(fkTargets(productImages)).toContain(products);
  });

  it("product_categories references products and categories", () => {
    const targets = fkTargets(productCategories);
    expect(targets).toContain(products);
    expect(targets).toContain(categories);
  });

  it("product_attributes references products", () => {
    expect(fkTargets(productAttributes)).toContain(products);
  });

  it("inventory_movements references product_variants and admin_users", () => {
    const targets = fkTargets(inventoryMovements);
    expect(targets).toContain(productVariants);
    expect(targets).toContain(adminUsers);
  });
});
