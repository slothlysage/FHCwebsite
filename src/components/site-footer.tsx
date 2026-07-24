import Link from "next/link";

const POLICY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
  { href: "/shipping", label: "Shipping" },
  { href: "/returns", label: "Returns" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-sand bg-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-ink">Handmade candles &amp; body butter.</p>
        <nav
          aria-label="Policies"
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink"
        >
          {POLICY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-sage-dark"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
