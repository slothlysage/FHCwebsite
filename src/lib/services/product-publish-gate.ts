// Pure decision logic for specs/04-admin.md's Screens section: "Publish is
// blocked unless: at least one image with alt text, at least one active
// variant with a price, and non-empty ingredients and safety info." No DB
// access here — src/lib/actions/admin-products.ts's publishProductAction
// (4.3d) fetches the product/images/variants it already needs for the
// audit-log "before" snapshot and passes them straight in, so this stays
// unit-testable without a database, same as catalog-importer.ts's parser.

export type PublishGateFailure =
  | "no_image_with_alt_text"
  | "no_active_priced_variant"
  | "missing_ingredients"
  | "missing_safety_info";

export type PublishGateResult =
  { ok: true } | { ok: false; failures: PublishGateFailure[] };

type GateProduct = {
  ingredients: string | null;
  safetyInfo: string | null;
};

type GateImage = { altText: string };

type GateVariant = { isActive: boolean; priceCents: number };

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

export function checkPublishGate(input: {
  product: GateProduct;
  images: GateImage[];
  variants: GateVariant[];
}): PublishGateResult {
  const failures: PublishGateFailure[] = [];

  if (!input.images.some((image) => image.altText.trim().length > 0)) {
    failures.push("no_image_with_alt_text");
  }
  if (
    !input.variants.some(
      (variant) => variant.isActive && variant.priceCents > 0,
    )
  ) {
    failures.push("no_active_priced_variant");
  }
  if (isBlank(input.product.ingredients)) {
    failures.push("missing_ingredients");
  }
  if (isBlank(input.product.safetyInfo)) {
    failures.push("missing_safety_info");
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
