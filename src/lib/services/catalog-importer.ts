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
}

export interface ParsedImage {
  url: string;
  altText: string;
  position: number;
}

export interface ParsedProduct {
  handle: string;
  slug: string;
  name: string;
  description: string | null;
  categories: string[];
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
      product = {
        handle,
        slug: handle.toLowerCase(),
        name: title,
        description: raw["Body (HTML)"]?.trim() || null,
        categories: tags
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : [],
        variants: [],
        images: [],
      };
      productsByHandle.set(handle, product);
    }

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
