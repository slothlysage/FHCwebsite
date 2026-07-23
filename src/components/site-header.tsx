import Link from "next/link";

import { readCartId } from "@/lib/cart-cookie";
import { getCartSummary } from "@/lib/services/cart";

const NAV_LINKS = [
  { href: "/products", label: "Shop" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// No cart_id cookie yet means no cart has ever been created for this visitor
// — reads only, never creates one (that's the add-to-cart action's job, see
// lib/actions/cart.ts) so simply loading a page never writes a cookie.
async function getCartItemCount(): Promise<number> {
  const cartId = await readCartId();
  if (!cartId) {
    return 0;
  }
  const { lines } = await getCartSummary(cartId);
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export async function SiteHeader() {
  const cartItemCount = await getCartItemCount();
  return (
    <header className="border-b border-sand bg-cream">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-ink"
        >
          FHC
        </Link>
        <nav
          aria-label="Main"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-ink"
        >
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-clay">
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/cart"
          aria-label={`Cart, ${cartItemCount} items`}
          className="flex items-center gap-2 text-sm font-medium text-ink hover:text-clay"
        >
          <span aria-hidden="true">Cart</span>
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-clay text-xs font-semibold text-cream"
          >
            {cartItemCount}
          </span>
        </Link>
      </div>
    </header>
  );
}
