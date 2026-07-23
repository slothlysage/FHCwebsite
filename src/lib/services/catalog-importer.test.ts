import { describe, expect, it } from "vitest";

import { parseShopifyCsv } from "@/lib/services/catalog-importer";

const HEADER =
  "Handle,Title,Body (HTML),Type,Tags,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Variant Compare At Price,Variant Grams,Variant Inventory Qty,Image Src,Image Position,Image Alt Text,Published,Status";

function row(fields: Record<string, string>): string {
  const cols = HEADER.split(",");
  return cols
    .map((c) => {
      const v = fields[c] ?? "";
      return v.includes(",") ? `"${v}"` : v;
    })
    .join(",");
}

describe("parseShopifyCsv", () => {
  it("parses a well-formed multi-variant, multi-image product", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Body (HTML)": "A calming candle",
        Tags: "candles, seasonal",
        "Option1 Value": "8oz",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Compare At Price": "28.00",
        "Variant Grams": "227",
        "Variant Inventory Qty": "12",
        "Image Src": "https://example.com/lav1.jpg",
        "Image Position": "1",
        "Image Alt Text": "Lavender candle, 8oz jar",
      }),
      row({
        Handle: "lavender-candle",
        "Option1 Value": "16oz",
        "Variant SKU": "LAV-16OZ",
        "Variant Price": "42.00",
        "Variant Grams": "454",
      }),
      row({
        Handle: "lavender-candle",
        "Image Src": "https://example.com/lav2.jpg",
        "Image Position": "2",
        "Image Alt Text": "Lavender candle lit",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(1);
    const product = result.products[0]!;
    expect(product.slug).toBe("lavender-candle");
    expect(product.name).toBe("Lavender Candle");
    expect(product.description).toBe("A calming candle");
    expect(product.categories).toEqual(["candles", "seasonal"]);
    expect(product.variants).toHaveLength(2);
    expect(product.variants[0]).toMatchObject({
      sku: "LAV-8OZ",
      name: "8oz",
      priceCents: 2400,
      compareAtPriceCents: 2800,
      weightGrams: 227,
      position: 0,
      stockQuantity: 12,
    });
    expect(product.variants[1]).toMatchObject({
      sku: "LAV-16OZ",
      name: "16oz",
      priceCents: 4200,
      compareAtPriceCents: null,
      weightGrams: 454,
      position: 1,
      stockQuantity: 0,
    });
    expect(product.images).toHaveLength(2);
    expect(product.images[1]).toMatchObject({
      url: "https://example.com/lav2.jpg",
      altText: "Lavender candle lit",
      position: 2,
    });
  });

  it("reports every missing required column and parses no products", () => {
    const brokenHeader = "Handle,Title,Variant SKU";
    const csv = [brokenHeader, "lavender-candle,Lavender Candle,LAV-8OZ"].join(
      "\n",
    );

    const result = parseShopifyCsv(csv);

    expect(result.products).toEqual([]);
    expect(result.errors).toEqual([
      {
        row: 0,
        handle: null,
        message: "Missing required column: Variant Price",
      },
      {
        row: 0,
        handle: null,
        message: "Missing required column: Variant Grams",
      },
    ]);
  });

  it("reports a duplicate SKU and keeps only the first occurrence", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
      }),
      row({
        Handle: "vanilla-candle",
        Title: "Vanilla Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "26.00",
        "Variant Grams": "227",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      { row: 3, handle: "vanilla-candle", message: "Duplicate SKU: LAV-8OZ" },
    ]);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]!.variants).toHaveLength(1);
    expect(result.products[1]!.variants).toHaveLength(0);
  });

  it("reports a non-numeric price and skips only that variant", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "not-a-number",
        "Variant Grams": "227",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      {
        row: 2,
        handle: "lavender-candle",
        message: "Non-numeric Variant Price 'not-a-number' for SKU LAV-8OZ",
      },
    ]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]!.variants).toEqual([]);
  });

  it("reports a non-numeric compare-at price and skips only that variant", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Compare At Price": "n/a",
        "Variant Grams": "227",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      {
        row: 2,
        handle: "lavender-candle",
        message: "Non-numeric Variant Compare At Price 'n/a' for SKU LAV-8OZ",
      },
    ]);
    expect(result.products[0]!.variants).toEqual([]);
  });

  it("reports a non-numeric weight and skips only that variant", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "heavy",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      {
        row: 2,
        handle: "lavender-candle",
        message: "Non-numeric Variant Grams 'heavy' for SKU LAV-8OZ",
      },
    ]);
    expect(result.products[0]!.variants).toEqual([]);
  });

  it("reports a row with a blank Handle and skips it", () => {
    const csv = [
      HEADER,
      row({
        Handle: "",
        Title: "Orphan",
        "Variant SKU": "ORPHAN-1",
        "Variant Price": "10.00",
        "Variant Grams": "100",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      { row: 2, handle: null, message: "Missing Handle" },
    ]);
    expect(result.products).toEqual([]);
  });

  it("reports a new-product row with a blank Title", () => {
    const csv = [
      HEADER,
      row({
        Handle: "no-title",
        Title: "",
        "Variant SKU": "NT-1",
        "Variant Price": "10.00",
        "Variant Grams": "100",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([
      { row: 2, handle: "no-title", message: "Missing Title for new product" },
    ]);
    expect(result.products).toEqual([]);
  });

  it("treats a row with no Variant SKU as an image-only continuation row", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
      }),
      row({
        Handle: "lavender-candle",
        "Image Src": "https://example.com/extra.jpg",
        "Image Alt Text": "Extra shot",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.variants).toHaveLength(1);
    expect(result.products[0]!.images).toHaveLength(1);
  });

  it("parses a minimal CSV containing only the required columns", () => {
    const minimalHeader =
      "Handle,Title,Variant SKU,Variant Price,Variant Grams";
    const csv = [
      minimalHeader,
      "lavender-candle,Lavender Candle,LAV-8OZ,24.00,227",
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(1);
    const product = result.products[0]!;
    expect(product.description).toBeNull();
    expect(product.categories).toEqual([]);
    expect(product.attributes).toEqual([]);
    expect(product.images).toEqual([]);
    expect(product.variants[0]).toMatchObject({
      sku: "LAV-8OZ",
      name: "Lavender Candle",
      priceCents: 2400,
      compareAtPriceCents: null,
    });
  });

  it("defaults Image Alt Text to an empty string when the column is absent", () => {
    const header =
      "Handle,Title,Variant SKU,Variant Price,Variant Grams,Image Src";
    const csv = [
      header,
      "lavender-candle,Lavender Candle,LAV-8OZ,24.00,227,https://example.com/lav1.jpg",
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.images).toEqual([
      { url: "https://example.com/lav1.jpg", altText: "", position: 1 },
    ]);
  });

  it("defaults stockQuantity to 0 when Variant Inventory Qty is absent or non-numeric", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
        "Variant Inventory Qty": "not-a-number",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.variants[0]).toMatchObject({
      sku: "LAV-8OZ",
      stockQuantity: 0,
    });
  });

  it("maps OptionN Name/Value pairs into distinct product-level attributes", () => {
    const csv = [
      HEADER,
      row({
        Handle: "shampoo-bar",
        Title: "Shampoo Bar",
        "Option1 Name": "Scent",
        "Option1 Value": "Balsam Fir",
        "Variant SKU": "SHMP-BALSAM",
        "Variant Price": "12.00",
        "Variant Grams": "113",
      }),
      row({
        Handle: "shampoo-bar",
        "Option1 Value": "Old Books",
        "Variant SKU": "SHMP-BOOKS",
        "Variant Price": "12.00",
        "Variant Grams": "113",
      }),
      row({
        // Same value seen again for a different variant — must not duplicate.
        Handle: "shampoo-bar",
        "Option1 Value": "Balsam Fir",
        "Variant SKU": "SHMP-BALSAM-2",
        "Variant Price": "12.00",
        "Variant Grams": "113",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.attributes).toEqual([
      { key: "scent", value: "Balsam Fir" },
      { key: "scent", value: "Old Books" },
    ]);
  });

  it("collects a second OptionN Name/Value pair independently of the first", () => {
    const csv = [
      HEADER,
      row({
        Handle: "candle",
        Title: "Candle",
        "Option1 Name": "Scent",
        "Option1 Value": "Lavender",
        "Option2 Name": "Size",
        "Option2 Value": "8oz",
        "Variant SKU": "CANDLE-LAV-8",
        "Variant Price": "24.00",
        "Variant Grams": "227",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.attributes).toEqual([
      { key: "scent", value: "Lavender" },
      { key: "size", value: "8oz" },
    ]);
  });

  it("falls back to Type as a category when Tags is blank", () => {
    const csv = [
      HEADER,
      row({
        Handle: "shampoo-bar",
        Title: "Shampoo Bar",
        Type: "Hair Care",
        Tags: "",
        "Variant SKU": "SHMP-1",
        "Variant Price": "12.00",
        "Variant Grams": "113",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.categories).toEqual(["Hair Care"]);
  });

  it("prefers Tags over Type when both are present", () => {
    const csv = [
      HEADER,
      row({
        Handle: "shampoo-bar",
        Title: "Shampoo Bar",
        Type: "Hair Care",
        Tags: "candles",
        "Variant SKU": "SHMP-1",
        "Variant Price": "12.00",
        "Variant Grams": "113",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.categories).toEqual(["candles"]);
  });

  it("returns an empty result for an empty catalog", () => {
    const result = parseShopifyCsv(HEADER);
    expect(result).toEqual({ products: [], errors: [] });
  });

  it("maps Status 'active' with Published 'true' to a published product", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
        Published: "true",
        Status: "active",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.status).toBe("published");
  });

  it("maps Status 'draft' and 'archived' to the matching statuses", () => {
    const csv = [
      HEADER,
      row({
        Handle: "draft-candle",
        Title: "Draft Candle",
        "Variant SKU": "DRAFT-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
        Published: "true",
        Status: "draft",
      }),
      row({
        Handle: "archived-candle",
        Title: "Archived Candle",
        "Variant SKU": "ARCH-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
        Published: "true",
        Status: "archived",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.status).toBe("draft");
    expect(result.products[1]!.status).toBe("archived");
  });

  it("treats Status 'active' with Published 'false' as draft", () => {
    const csv = [
      HEADER,
      row({
        Handle: "lavender-candle",
        Title: "Lavender Candle",
        "Variant SKU": "LAV-8OZ",
        "Variant Price": "24.00",
        "Variant Grams": "227",
        Published: "false",
        Status: "active",
      }),
    ].join("\n");

    const result = parseShopifyCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.products[0]!.status).toBe("draft");
  });

  it("defaults status to draft when Status is missing, blank, or unknown", () => {
    const minimalHeader =
      "Handle,Title,Variant SKU,Variant Price,Variant Grams";
    const missingColumn = parseShopifyCsv(
      [minimalHeader, "lavender-candle,Lavender Candle,LAV-8OZ,24.00,227"].join(
        "\n",
      ),
    );
    expect(missingColumn.errors).toEqual([]);
    expect(missingColumn.products[0]!.status).toBe("draft");

    const blank = parseShopifyCsv(
      [
        HEADER,
        row({
          Handle: "lavender-candle",
          Title: "Lavender Candle",
          "Variant SKU": "LAV-8OZ",
          "Variant Price": "24.00",
          "Variant Grams": "227",
        }),
      ].join("\n"),
    );
    expect(blank.errors).toEqual([]);
    expect(blank.products[0]!.status).toBe("draft");

    const unknown = parseShopifyCsv(
      [
        HEADER,
        row({
          Handle: "lavender-candle",
          Title: "Lavender Candle",
          "Variant SKU": "LAV-8OZ",
          "Variant Price": "24.00",
          "Variant Grams": "227",
          Published: "true",
          Status: "something-else",
        }),
      ].join("\n"),
    );
    expect(unknown.errors).toEqual([]);
    expect(unknown.products[0]!.status).toBe("draft");
  });
});
