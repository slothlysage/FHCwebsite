// CLI entry point for `npm run sync-stripe -- [--apply]`.
// Dry-run (the default) reports the sync plan for every active variant of a
// published, non-deleted product without calling Stripe or writing to the
// DB. `--apply` performs it. Mirrors scripts/import-catalog.mts's shape —
// same reason: reuse the already-tested service, don't reimplement it here.
import { runStripeSync } from "@/lib/services/stripe-catalog-sync";

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");

  console.log(
    apply
      ? "Applying Stripe catalog sync..."
      : "Dry run for Stripe catalog sync (pass --apply to write):",
  );

  const results = await runStripeSync({ apply });

  const counts = { skip: 0, create: 0, replace: 0, noop: 0 };
  for (const result of results) {
    counts[result.action]++;
    console.log(`  [${result.action}] ${result.sku} -> ${result.stripePriceId ?? "(none)"}`);
  }

  console.log(
    `\n${counts.create} to create, ${counts.replace} to replace, ${counts.noop} unchanged, ${counts.skip} skipped.`,
  );
}

await main();
