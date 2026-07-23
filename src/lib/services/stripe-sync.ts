// Pure Stripe-Price sync decision logic. No Stripe SDK calls, no DB calls —
// 3.2b's job is to fetch the inputs below and apply the returned action.

export type VariantSyncInput = {
  priceCents: number;
  isActive: boolean;
  stripePriceId: string | null;
};

export type StripePriceSnapshot = {
  unitAmount: number;
  active: boolean;
};

export type VariantSyncPlan =
  | { action: "skip" }
  | { action: "create" }
  | { action: "replace" }
  | { action: "noop" };

// currentPrice is the live Stripe Price for variant.stripePriceId, fetched by
// the caller — only meaningful when stripePriceId is already set. `null` means
// either stripePriceId isn't set yet, or it is set but the Stripe object
// couldn't be found (e.g. deleted out-of-band).
export function planVariantSync(
  variant: VariantSyncInput,
  currentPrice: StripePriceSnapshot | null,
): VariantSyncPlan {
  if (!variant.isActive) {
    return { action: "skip" };
  }

  if (variant.stripePriceId === null) {
    return { action: "create" };
  }

  if (currentPrice === null) {
    return { action: "create" };
  }

  if (!currentPrice.active || currentPrice.unitAmount !== variant.priceCents) {
    return { action: "replace" };
  }

  return { action: "noop" };
}
