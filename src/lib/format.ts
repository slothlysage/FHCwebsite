const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "usd",
});

export function formatPriceCents(cents: number): string {
  return usdFormatter.format(cents / 100);
}
