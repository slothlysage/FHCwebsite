import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { db } from "@/lib/db/client";
import { productVariants, products } from "@/lib/db/schema";
import { createProduct } from "@/lib/repos/products";
import { createVariant, getVariantById } from "@/lib/repos/variants";
import type { runStripeSync as RunStripeSync } from "@/lib/services/stripe-catalog-sync";
import {
  getStripeFakePrices,
  getStripeFakeProducts,
  resetStripeFakeState,
  seedStripePrice,
  stripeServer,
} from "../../../tests/msw/stripe-server";

// Integration tests against the real dev database (products/variants), with
// Stripe itself intercepted at the network boundary via msw — see
// tests/msw/stripe-server.ts for why msw was chosen over stripe-mock/
// recorded fixtures.
//
// `runStripeSync` (and, transitively, `@/lib/stripe/client`'s module-load
// singleton) is imported dynamically, AFTER `stripeServer.listen()`, not via
// a static top-level import. Stripe's `FetchHttpClient` captures whatever
// `globalThis.fetch` is current at *construction* time (a plain variable
// assignment, not a per-call lookup — see node_modules/stripe/cjs/net/
// FetchHttpClient.js), and static imports always execute before any of this
// file's own code, including `beforeAll`. Constructing the client before msw
// patches `fetch` means every request silently escapes the mock and hits the
// real Stripe test-mode API instead of timing out or erroring — confirmed by
// hand: an earlier version of this file with a static import created a real
// Price against the real test-mode account. `vi.resetModules()` + dynamic
// `import()` is the same pattern `src/lib/stripe/client.test.ts`/`env.test.ts`
// already use for load-time-side-effect modules, applied here for the same
// reason.
let runStripeSync: typeof RunStripeSync;

beforeAll(async () => {
  stripeServer.listen({ onUnhandledRequest: "error" });
  vi.resetModules();
  ({ runStripeSync } = await import("@/lib/services/stripe-catalog-sync"));
});
afterEach(() => {
  stripeServer.resetHandlers();
  resetStripeFakeState();
});
afterAll(() => stripeServer.close());

describe("runStripeSync", () => {
  const insertedProductIds: string[] = [];

  afterEach(async () => {
    for (const productId of insertedProductIds.splice(0)) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  async function makePublishedProductWithVariant(
    slug: string,
    variantPatch: {
      priceCents: number;
      stripePriceId?: string | null;
    },
  ) {
    const product = await createProduct({
      slug,
      name: `Test ${slug}`,
      status: "published",
    });
    insertedProductIds.push(product.id);
    const variant = await createVariant({
      productId: product.id,
      sku: `TEST-SYNC-${slug.toUpperCase()}`,
      name: "Test Variant",
      priceCents: variantPatch.priceCents,
      weightGrams: 100,
      stripePriceId: variantPatch.stripePriceId ?? null,
    });
    return {
      product,
      variant,
      syncable: { ...variant, productName: product.name },
    };
  }

  it("dry run reports the plan without calling Stripe writes or touching the DB", async () => {
    const { variant, syncable } = await makePublishedProductWithVariant(
      "dry-run",
      { priceCents: 1000 },
    );

    const results = await runStripeSync({ apply: false }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("create");
    expect(result?.stripePriceId).toBeNull();
    expect(getStripeFakeProducts()).toHaveLength(0);
    expect(getStripeFakePrices()).toHaveLength(0);

    const stillUnsynced = await getVariantById(variant.id);
    expect(stillUnsynced?.stripePriceId).toBeNull();
  });

  it("creates a Stripe Product + Price for a variant with no stripePriceId", async () => {
    const { variant, syncable } = await makePublishedProductWithVariant(
      "create",
      { priceCents: 1234 },
    );

    const results = await runStripeSync({ apply: true }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("create");
    expect(result?.stripePriceId).toMatch(/^price_test_/);

    const createdPrice = getStripeFakePrices().find(
      (p) => p.id === result?.stripePriceId,
    );
    expect(createdPrice?.unit_amount).toBe(1234);
    expect(createdPrice?.metadata.variant_id).toBe(variant.id);

    const createdProduct = getStripeFakeProducts().find(
      (p) => p.id === createdPrice?.product,
    );
    expect(createdProduct?.name).toContain("Test Variant");

    const updated = await getVariantById(variant.id);
    expect(updated?.stripePriceId).toBe(result?.stripePriceId);
  });

  it("treats a stripePriceId Stripe can't find as create (deleted out-of-band)", async () => {
    const { variant, syncable } = await makePublishedProductWithVariant(
      "missing",
      { priceCents: 500, stripePriceId: "price_does_not_exist" },
    );

    const results = await runStripeSync({ apply: true }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("create");
    expect(result?.stripePriceId).not.toBe("price_does_not_exist");
  });

  it("propagates a genuine Stripe error instead of treating it as a missing price", async () => {
    stripeServer.use(
      http.get("https://api.stripe.com/v1/prices/:id", () =>
        HttpResponse.json(
          {
            error: {
              type: "api_error",
              code: "lock_timeout",
              message: "try again",
            },
          },
          { status: 500 },
        ),
      ),
    );
    const { syncable } = await makePublishedProductWithVariant("error", {
      priceCents: 500,
      stripePriceId: "price_seed_error",
    });

    await expect(runStripeSync({ apply: true }, [syncable])).rejects.toThrow(
      /try again/,
    );
  });

  it("is a noop when the Stripe Price already matches", async () => {
    seedStripePrice({
      id: "price_seed_noop",
      object: "price",
      active: true,
      unit_amount: 750,
      currency: "usd",
      product: "prod_seed_noop",
      metadata: {},
    });
    const { variant, syncable } = await makePublishedProductWithVariant(
      "noop",
      { priceCents: 750, stripePriceId: "price_seed_noop" },
    );

    const results = await runStripeSync({ apply: true }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("noop");
    expect(result?.stripePriceId).toBe("price_seed_noop");
    expect(getStripeFakePrices()).toHaveLength(1);
  });

  it("replaces the Price and archives the old one when the local price changed", async () => {
    seedStripePrice({
      id: "price_seed_replace",
      object: "price",
      active: true,
      unit_amount: 900,
      currency: "usd",
      product: "prod_seed_replace",
      metadata: {},
    });
    const { variant, syncable } = await makePublishedProductWithVariant(
      "replace",
      { priceCents: 1100, stripePriceId: "price_seed_replace" },
    );

    const results = await runStripeSync({ apply: true }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("replace");
    expect(result?.stripePriceId).not.toBe("price_seed_replace");

    const oldPrice = getStripeFakePrices().find(
      (p) => p.id === "price_seed_replace",
    );
    expect(oldPrice?.active).toBe(false);

    const newPrice = getStripeFakePrices().find(
      (p) => p.id === result?.stripePriceId,
    );
    expect(newPrice?.unit_amount).toBe(1100);
    expect(newPrice?.product).toBe("prod_seed_replace");

    const updated = await getVariantById(variant.id);
    expect(updated?.stripePriceId).toBe(result?.stripePriceId);
  });

  it("replaces when the stored Price is archived even at the same amount", async () => {
    seedStripePrice({
      id: "price_seed_archived",
      object: "price",
      active: false,
      unit_amount: 600,
      currency: "usd",
      product: "prod_seed_archived",
      metadata: {},
    });
    const { variant, syncable } = await makePublishedProductWithVariant(
      "archived",
      { priceCents: 600, stripePriceId: "price_seed_archived" },
    );

    const results = await runStripeSync({ apply: true }, [syncable]);
    const result = results.find((r) => r.variantId === variant.id);

    expect(result?.action).toBe("replace");
    expect(result?.stripePriceId).not.toBe("price_seed_archived");
  });

  it("running sync twice creates no duplicate Stripe objects", async () => {
    const { variant, syncable } = await makePublishedProductWithVariant(
      "rerun",
      { priceCents: 2000 },
    );

    const first = await runStripeSync({ apply: true }, [syncable]);
    const firstResult = first.find((r) => r.variantId === variant.id);
    const countsAfterFirst = {
      products: getStripeFakeProducts().length,
      prices: getStripeFakePrices().length,
    };

    // Re-fetch the variant so the second run's input reflects the
    // stripePriceId the first run just wrote back — a real second CLI
    // invocation would read this fresh from the DB too.
    const resynced = await getVariantById(variant.id);
    const second = await runStripeSync({ apply: true }, [
      { ...resynced!, productName: syncable.productName },
    ]);
    const secondResult = second.find((r) => r.variantId === variant.id);

    expect(secondResult?.action).toBe("noop");
    expect(secondResult?.stripePriceId).toBe(firstResult?.stripePriceId);
    expect(getStripeFakeProducts()).toHaveLength(countsAfterFirst.products);
    expect(getStripeFakePrices()).toHaveLength(countsAfterFirst.prices);
  });
});
