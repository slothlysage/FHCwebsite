const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "usd",
});

export function formatPriceCents(cents: number): string {
  return usdFormatter.format(cents / 100);
}

// A plain "24.99"-shaped dollar string, no currency symbol or thousands
// separators — for pre-filling an editable price input (4.4a's variant
// form), unlike formatPriceCents' display-only "$24.99" output. `null`
// (an absent compare-at price) becomes an empty string, matching the form's
// own "blank means not provided" convention (variant-form.ts).
export function centsToDollarsInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
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
