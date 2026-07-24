import type { DbExecutor } from "@/lib/db/client";
import { replaceProductAttributes } from "@/lib/repos/attributes";
import {
  createCategory,
  getCategoryBySlug,
  linkProductCategory,
} from "@/lib/repos/categories";
import { replaceProductImages } from "@/lib/repos/images";
import { recordMovement } from "@/lib/repos/inventory";
import {
  createProduct,
  getProductBySlug,
  updateProduct,
} from "@/lib/repos/products";
import { withTransaction } from "@/lib/repos/transaction";
import {
  createVariant,
  getVariantBySku,
  updateVariant,
} from "@/lib/repos/variants";
import type {
  ParsedProduct,
  ParsedVariant,
} from "@/lib/services/catalog-importer";
import { slugify } from "@/lib/slugify";

// Diffs/writes the pure output of `parseShopifyCsv` (1.4a) against the
// current catalog. This module does the DB reads/writes; parsing itself
// stays DB-free in catalog-importer.ts.

export type DiffAction = "create" | "update" | "unchanged";

export interface VariantDiffEntry {
  sku: string;
  action: DiffAction;
}

export interface ProductDiffEntry {
  slug: string;
  action: DiffAction;
  variants: VariantDiffEntry[];
}

export interface CatalogImportResult {
  products: ProductDiffEntry[];
}

type ExistingProduct = {
  name: string;
  description: string | null;
  status: string;
};
type ExistingVariant = {
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  weightGrams: number;
  position: number;
};

function productChanged(
  existing: ExistingProduct,
  parsed: ParsedProduct,
): boolean {
  return (
    existing.name !== parsed.name ||
    existing.description !== parsed.description ||
    existing.status !== parsed.status
  );
}

function variantChanged(
  existing: ExistingVariant,
  parsed: ParsedVariant,
): boolean {
  return (
    existing.name !== parsed.name ||
    existing.priceCents !== parsed.priceCents ||
    existing.compareAtPriceCents !== parsed.compareAtPriceCents ||
    existing.weightGrams !== parsed.weightGrams ||
    existing.position !== parsed.position
  );
}

async function importProduct(
  parsed: ParsedProduct,
  apply: boolean,
  executor: DbExecutor | undefined,
): Promise<ProductDiffEntry> {
  const existingProduct = await getProductBySlug(parsed.slug, executor);
  const productAction: DiffAction = !existingProduct
    ? "create"
    : productChanged(existingProduct, parsed)
      ? "update"
      : "unchanged";

  let product = existingProduct;
  if (apply) {
    if (!product) {
      product = await createProduct(
        {
          slug: parsed.slug,
          name: parsed.name,
          description: parsed.description,
          status: parsed.status,
        },
        executor,
      );
    } else if (productAction === "update") {
      product =
        (await updateProduct(
          product.id,
          {
            name: parsed.name,
            description: parsed.description,
            status: parsed.status,
          },
          executor,
        )) ?? product;
    }
  }

  const variantDiffs: VariantDiffEntry[] = [];
  for (const variant of parsed.variants) {
    const existingVariant = await getVariantBySku(variant.sku, executor);
    const variantAction: DiffAction = !existingVariant
      ? "create"
      : variantChanged(existingVariant, variant)
        ? "update"
        : "unchanged";

    if (apply && product) {
      if (!existingVariant) {
        const created = await createVariant(
          {
            productId: product.id,
            sku: variant.sku,
            name: variant.name,
            priceCents: variant.priceCents,
            compareAtPriceCents: variant.compareAtPriceCents,
            weightGrams: variant.weightGrams,
            position: variant.position,
          },
          executor,
        );
        await recordMovement(
          {
            variantId: created.id,
            delta: variant.stockQuantity,
            reason: "import",
            note: `Initial import: ${parsed.slug}`,
          },
          executor,
        );
      } else if (variantAction === "update") {
        await updateVariant(
          existingVariant.id,
          {
            name: variant.name,
            priceCents: variant.priceCents,
            compareAtPriceCents: variant.compareAtPriceCents,
            weightGrams: variant.weightGrams,
            position: variant.position,
          },
          executor,
        );
      }
    }

    variantDiffs.push({ sku: variant.sku, action: variantAction });
  }

  if (apply && product) {
    for (const categoryName of parsed.categories) {
      const slug = slugify(categoryName);
      const category =
        (await getCategoryBySlug(slug, executor)) ??
        (await createCategory({ slug, name: categoryName }, executor));
      await linkProductCategory(product.id, category.id, executor);
    }

    await replaceProductAttributes(product.id, parsed.attributes, executor);

    await replaceProductImages(
      product.id,
      parsed.images.map((image) => ({
        url: image.url,
        altText: image.altText,
        position: image.position,
        // Real dimensions require fetching/processing the image bytes,
        // which is 4.5's job (R2 upload pipeline: magic-byte validation,
        // EXIF stripping, responsive sizes). The CSV export carries no
        // width/height, so this is a placeholder 4.5 backfills.
        width: 0,
        height: 0,
      })),
      executor,
    );
  }

  return { slug: parsed.slug, action: productAction, variants: variantDiffs };
}

export async function runCatalogImport(
  parsedProducts: ParsedProduct[],
  options: { apply: boolean },
): Promise<CatalogImportResult> {
  const run = (
    executor: DbExecutor | undefined,
  ): Promise<CatalogImportResult> =>
    (async () => {
      const productDiffs: ProductDiffEntry[] = [];
      for (const parsed of parsedProducts) {
        productDiffs.push(await importProduct(parsed, options.apply, executor));
      }
      return { products: productDiffs };
    })();

  if (options.apply) {
    return withTransaction((tx) => run(tx));
  }
  return run(undefined);
}
