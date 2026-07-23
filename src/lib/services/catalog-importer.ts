import { parse } from "csv-parse/sync";

// Parses Shopify's standard product CSV export format. Rows are grouped by
// `Handle`: the first row for a handle carries product-level fields (Title,
// Body (HTML), Tags); subsequent rows for the same handle add variants
// and/or images and leave product-level columns blank. This module is pure
// (no DB access) — 1.4b diffs/writes the parsed result against the database.

export interface ParsedVariant {
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  weightGrams: number;
  position: number;
  /** Initial stock for the "import" inventory movement 1.4b writes. Defaults
   * to 0 when the column is absent or non-numeric — an unknown starting
   * count is not a row-level error the way a missing price/weight is. */
  stockQuantity: number;
}

export interface ParsedImage {
  url: string;
  altText: string;
  position: number;
}

/** A product-level filter facet, e.g. `{ key: "scent", value: "lavender" }`.
 * `key` comes from `OptionN Name` (present once, on a product's first row);
 * `value` comes from `OptionN Value`, read per variant row and deduped —
 * a product with several scent variants gets one attribute row per distinct
 * scent, not one per variant. */
export interface ParsedAttribute {
  key: string;
  value: string;
}

export type ParsedProductStatus = "draft" | "published" | "archived";

export interface ParsedProduct {
  handle: string;
  slug: string;
  name: string;
  description: string | null;
  status: ParsedProductStatus;
  categories: string[];
  attributes: ParsedAttribute[];
  variants: ParsedVariant[];
  images: ParsedImage[];
}

export interface ImportRowError {
  /** 1-based data row number (header excluded); 0 for whole-file errors. */
  row: number;
  handle: string | null;
  message: string;
}

export interface ParseCsvResult {
  products: ParsedProduct[];
  errors: ImportRowError[];
}

const REQUIRED_COLUMNS = [
  "Handle",
  "Title",
  "Variant SKU",
  "Variant Price",
  "Variant Grams",
] as const;

type CsvRow = Record<string, string>;

function parseMoney(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Shopify's `Status` is active/draft/archived; `Published` is a separate
// true/false. `active` only maps to `published` when `Published` doesn't
// contradict it. Anything unrecognized falls back to `draft` — same
// permissive convention as the other optional columns, never a row error.
function parseStatus(
  statusRaw: string | undefined,
  publishedRaw: string | undefined,
): ParsedProductStatus {
  const status = statusRaw?.trim().toLowerCase() ?? "";
  if (status === "archived") return "archived";
  const published = publishedRaw?.trim().toLowerCase() !== "false";
  if (status === "active" && published) return "published";
  return "draft";
}

export function parseShopifyCsv(csvText: string): ParseCsvResult {
  const records: CsvRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  });

  const errors: ImportRowError[] = [];
  const header =
    records.length > 0
      ? Object.keys(records[0]!)
      : csvText
          .split("\n")[0]!
          .split(",")
          .map((c) => c.trim());
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) {
    for (const column of missingColumns) {
      errors.push({
        row: 0,
        handle: null,
        message: `Missing required column: ${column}`,
      });
    }
    return { products: [], errors };
  }

  const productsByHandle = new Map<string, ParsedProduct>();
  const seenSkus = new Set<string>();
  // Option names (e.g. "Scent") appear once, on a product's first row;
  // `OptionN Value` (e.g. "Lavender") repeats per variant row. Both maps
  // are keyed by handle so later rows for the same product can look the
  // name back up and dedupe values against it.
  const optionNamesByHandle = new Map<string, Array<string | null>>();
  const seenAttributesByHandle = new Map<string, Set<string>>();

  records.forEach((raw, index) => {
    const rowNumber = index + 2; // +1 header, +1 to make it 1-based
    // Non-null: "Handle" is in REQUIRED_COLUMNS, so the header check above
    // guarantees this key exists, and csv-parse rejects rows whose column
    // count doesn't match the header — the value is always a string.
    const handle = raw["Handle"]!.trim();
    if (!handle) {
      errors.push({ row: rowNumber, handle: null, message: "Missing Handle" });
      return;
    }

    let product = productsByHandle.get(handle);
    if (!product) {
      const title = raw["Title"]!.trim();
      if (!title) {
        errors.push({
          row: rowNumber,
          handle,
          message: "Missing Title for new product",
        });
        return;
      }
      const tags = raw["Tags"]?.trim() ?? "";
      const type = raw["Type"]?.trim() ?? "";
      product = {
        handle,
        slug: handle.toLowerCase(),
        name: title,
        description: raw["Body (HTML)"]?.trim() || null,
        status: parseStatus(raw["Status"], raw["Published"]),
        // Tags win when present; a fixture/export with no Tags column (or a
        // blank value) still gets a usable category facet from Type.
        categories: tags
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : type
            ? [type]
            : [],
        attributes: [],
        variants: [],
        images: [],
      };
      productsByHandle.set(handle, product);
      optionNamesByHandle.set(
        handle,
        [raw["Option1 Name"], raw["Option2 Name"], raw["Option3 Name"]].map(
          (name) => name?.trim().toLowerCase() || null,
        ),
      );
      seenAttributesByHandle.set(handle, new Set());
    }

    const optionNames = optionNamesByHandle.get(handle)!;
    const seenAttributes = seenAttributesByHandle.get(handle)!;
    [raw["Option1 Value"], raw["Option2 Value"], raw["Option3 Value"]].forEach(
      (rawValue, optionIndex) => {
        const key = optionNames[optionIndex];
        const value = rawValue?.trim();
        if (!key || !value) return;
        const dedupeKey = `${key}::${value}`;
        if (seenAttributes.has(dedupeKey)) return;
        seenAttributes.add(dedupeKey);
        product!.attributes.push({ key, value });
      },
    );

    // Non-null: "Variant SKU"/"Variant Price"/"Variant Grams" are all
    // required columns — see the note on "Handle" above.
    const sku = raw["Variant SKU"]!.trim();
    if (sku) {
      if (seenSkus.has(sku)) {
        errors.push({
          row: rowNumber,
          handle,
          message: `Duplicate SKU: ${sku}`,
        });
      } else {
        seenSkus.add(sku);

        const priceRaw = raw["Variant Price"]!.trim();
        const priceCents = parseMoney(priceRaw);
        const gramsRaw = raw["Variant Grams"]!.trim();
        const weightGrams =
          Number.isFinite(Number(gramsRaw)) && gramsRaw !== ""
            ? Math.round(Number(gramsRaw))
            : null;
        const compareAtRaw = raw["Variant Compare At Price"]?.trim() ?? "";
        const compareAtPriceCents = compareAtRaw
          ? parseMoney(compareAtRaw)
          : null;
        const inventoryQtyRaw = raw["Variant Inventory Qty"]?.trim() ?? "";
        const stockQuantity =
          inventoryQtyRaw && Number.isFinite(Number(inventoryQtyRaw))
            ? Math.round(Number(inventoryQtyRaw))
            : 0;

        if (priceCents === null) {
          errors.push({
            row: rowNumber,
            handle,
            message: `Non-numeric Variant Price '${priceRaw}' for SKU ${sku}`,
          });
        } else if (compareAtRaw && compareAtPriceCents === null) {
          errors.push({
            row: rowNumber,
            handle,
            message: `Non-numeric Variant Compare At Price '${compareAtRaw}' for SKU ${sku}`,
          });
        } else if (weightGrams === null) {
          errors.push({
            row: rowNumber,
            handle,
            message: `Non-numeric Variant Grams '${gramsRaw}' for SKU ${sku}`,
          });
        } else {
          const name =
            [raw["Option1 Value"], raw["Option2 Value"], raw["Option3 Value"]]
              .map((v) => v?.trim())
              .filter((v): v is string => !!v)
              .join(" / ") || product.name;
          product.variants.push({
            sku,
            name,
            priceCents,
            compareAtPriceCents,
            weightGrams,
            position: product.variants.length,
            stockQuantity,
          });
        }
      }
    }

    const imageUrl = raw["Image Src"]?.trim() ?? "";
    if (imageUrl) {
      const positionRaw = raw["Image Position"]?.trim();
      const position =
        positionRaw && Number.isFinite(Number(positionRaw))
          ? Math.round(Number(positionRaw))
          : product.images.length + 1;
      product.images.push({
        url: imageUrl,
        altText: raw["Image Alt Text"]?.trim() ?? "",
        position,
      });
    }
  });

  return { products: Array.from(productsByHandle.values()), errors };
}
