// Stripe-API-calling apply step for catalog -> Stripe sync. Fetches the
// inputs `planVariantSync` (stripe-sync.ts, 3.2a) needs, applies whichever
// action it returns, and writes the resulting Stripe Price id back onto the
// variant. See specs/05-payments.md's "Implementation notes (3.2b)".
import type Stripe from "stripe";

import {
  listActiveVariantsOfPublishedProducts,
  updateVariant,
} from "@/lib/repos/variants";
import {
  planVariantSync,
  type StripePriceSnapshot,
} from "@/lib/services/stripe-sync";
import { stripe } from "@/lib/stripe/client";

type SyncableVariant = Awaited<
  ReturnType<typeof listActiveVariantsOfPublishedProducts>
>[number];

export type StripeSyncResult = {
  variantId: string;
  sku: string;
  action: "skip" | "create" | "replace" | "noop";
  stripePriceId: string | null;
};

// Stripe's own "not found" signal for a deleted-out-of-band Price — treated
// as if no stripePriceId were set at all (planVariantSync's "create" branch).
async function fetchStripePrice(priceId: string): Promise<Stripe.Price | null> {
  try {
    return await stripe.prices.retrieve(priceId);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "resource_missing"
    ) {
      return null;
    }
    throw error;
  }
}

function toSnapshot(price: Stripe.Price): StripePriceSnapshot {
  return { unitAmount: price.unit_amount ?? 0, active: price.active };
}

// Runs sync over `variants` (defaults to every active variant of a
// published, non-deleted product — the real CLI's only usage). `apply:
// false` only reads (Stripe retrieves are safe/free) and reports what would
// happen — no Product/Price is created or archived, and no DB row is
// written. `apply: true` performs the writes.
//
// `variants` is an explicit parameter, not always the full-catalog query,
// so tests can scope a run to exactly the variant(s) they created instead of
// syncing the shared dev database's entire real catalog on every test — the
// default is what the CLI actually wants, an override is what a test wants,
// same shape as `listProducts`' optional filters.
//
// Idempotency keys (not just metadata) are what make re-running after a
// crash mid-sync safe: a `create`/`replace` that got interrupted after the
// Stripe write but before the DB write-back will, on retry, resubmit the
// same key + parameters and get back the *same* Stripe object instead of a
// duplicate. The order within `replace` (create new Price, archive old,
// then write DB) is chosen so every crash point self-heals to the same
// final state on the next run — see specs/05-payments.md for the full
// crash-point trace.
export async function runStripeSync(
  options: { apply: boolean },
  variants?: SyncableVariant[],
): Promise<StripeSyncResult[]> {
  const targetVariants =
    variants ?? (await listActiveVariantsOfPublishedProducts());
  const results: StripeSyncResult[] = [];

  for (const variant of targetVariants) {
    const currentPrice = variant.stripePriceId
      ? await fetchStripePrice(variant.stripePriceId)
      : null;

    const plan = planVariantSync(
      {
        priceCents: variant.priceCents,
        isActive: variant.isActive,
        stripePriceId: variant.stripePriceId,
      },
      currentPrice ? toSnapshot(currentPrice) : null,
    );

    if (!options.apply || plan.action === "noop" || plan.action === "skip") {
      results.push({
        variantId: variant.id,
        sku: variant.sku,
        action: plan.action,
        stripePriceId: variant.stripePriceId,
      });
      continue;
    }

    if (plan.action === "create") {
      const product = await stripe.products.create(
        {
          name: `${variant.productName} — ${variant.name}`,
          metadata: { variant_id: variant.id },
        },
        { idempotencyKey: `variant-product-create-${variant.id}` },
      );
      const price = await stripe.prices.create(
        {
          product: product.id,
          unit_amount: variant.priceCents,
          currency: "usd",
          metadata: { variant_id: variant.id },
        },
        {
          idempotencyKey: `variant-price-create-${variant.id}-${variant.priceCents}`,
        },
      );
      await updateVariant(variant.id, { stripePriceId: price.id });
      results.push({
        variantId: variant.id,
        sku: variant.sku,
        action: "create",
        stripePriceId: price.id,
      });
      continue;
    }

    // action === "replace" — planVariantSync only returns this when
    // currentPrice was non-null, but that correlation isn't visible to the
    // type checker across the two functions, so assert the invariant
    // explicitly rather than silently dereferencing null.
    if (currentPrice === null) {
      throw new Error(
        `Invariant violated: "replace" action for variant ${variant.id} with no current Stripe price`,
      );
    }

    const productId =
      typeof currentPrice.product === "string"
        ? currentPrice.product
        : currentPrice.product.id;

    const newPrice = await stripe.prices.create(
      {
        product: productId,
        unit_amount: variant.priceCents,
        currency: "usd",
        metadata: { variant_id: variant.id },
      },
      {
        idempotencyKey: `variant-price-replace-${variant.id}-${variant.priceCents}`,
      },
    );
    await stripe.prices.update(currentPrice.id, { active: false });
    await updateVariant(variant.id, { stripePriceId: newPrice.id });
    results.push({
      variantId: variant.id,
      sku: variant.sku,
      action: "replace",
      stripePriceId: newPrice.id,
    });
  }

  return results;
}
