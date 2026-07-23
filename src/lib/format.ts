const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "usd",
});

export function formatPriceCents(cents: number): string {
  return usdFormatter.format(cents / 100);
}

// Meta descriptions get truncated by search engines around ~155-160
// characters anyway; doing it ourselves means the cut lands on a word
// boundary with an ellipsis instead of mid-word wherever the engine feels
// like clipping.
const META_DESCRIPTION_LIMIT = 160;

export function truncateForMeta(text: string | null): string | null {
  if (text === null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= META_DESCRIPTION_LIMIT) return collapsed;
  const truncated = collapsed.slice(0, META_DESCRIPTION_LIMIT - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 0 ? lastSpace : truncated.length)}…`;
}
