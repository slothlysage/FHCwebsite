import { getProductBySlug } from "@/lib/repos/products";
import { slugify } from "@/lib/slugify";

// specs/04-admin.md's Products screen: "slug (auto with manual override)".
// Derives a candidate slug from the name (or a manually-entered override,
// still run through slugify so a stray space/uppercase letter in a manual
// entry doesn't produce a differently-cased near-duplicate), then appends
// -2, -3, ... until free. `excludeProductId` is what makes editing a
// product without changing its name a no-op instead of colliding with
// itself.
export async function generateUniqueProductSlug(
  name: string,
  options: { manualSlug?: string; excludeProductId?: string } = {},
): Promise<string> {
  const base = slugify(options.manualSlug ?? name);
  let candidate = base;
  let suffix = 2;

  for (;;) {
    const existing = await getProductBySlug(candidate);
    if (!existing || existing.id === options.excludeProductId) {
      return candidate;
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}
