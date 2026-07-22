// CLI entry point for `npm run import-catalog -- <file> [--apply]`.
// Dry-run (the default) parses the Shopify CSV export and prints the diff
// against the current catalog without writing anything. `--apply` performs
// the write, transactionally, via `runCatalogImport`.
//
// Unlike db-migrate.mjs/db-reset.mjs, this script imports real src/lib
// TypeScript (the parser + diff/apply service) rather than reimplementing
// logic in plain JS — that logic already has thorough unit/integration
// test coverage, and duplicating it here would be exactly the parallel-
// implementation trap AGENT.md warns against. Run via `tsx`, not `node`,
// because Node 20 can't load TypeScript directly and this script's whole
// reason to exist is reusing existing .ts modules. `.mts` (not `.ts`)
// forces ESM output so the top-level `await main()` below works, the same
// reason vitest.config.mts is named that way (see fix_plan 0.2's note) —
// package.json has no top-level `"type": "module"`.
import { readFile } from "node:fs/promises";

import { runCatalogImport } from "@/lib/services/catalog-import";
import { parseShopifyCsv } from "@/lib/services/catalog-importer";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: import-catalog <file.csv> [--apply]");
    process.exitCode = 1;
    return;
  }

  const csvText = await readFile(filePath, "utf-8");
  const { products, errors } = parseShopifyCsv(csvText);

  if (errors.length > 0) {
    console.log(`${errors.length} row error(s):`);
    for (const error of errors) {
      console.log(`  row ${error.row} (${error.handle ?? "-"}): ${error.message}`);
    }
    console.log("");
  }

  console.log(
    apply
      ? `Applying import for ${products.length} product(s)...`
      : `Dry run for ${products.length} product(s) (pass --apply to write):`,
  );

  const result = await runCatalogImport(products, { apply });

  const counts = { create: 0, update: 0, unchanged: 0 };
  for (const product of result.products) {
    counts[product.action]++;
    console.log(`  [${product.action}] ${product.slug}`);
    for (const variant of product.variants) {
      console.log(`      [${variant.action}] ${variant.sku}`);
    }
  }

  console.log(
    `\n${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged.`,
  );
}

await main();
