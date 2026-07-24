import type { Metadata } from "next";

import { SupportEmailLink } from "@/components/support-email-link";

export const metadata: Metadata = {
  title: "Returns & Refunds Policy | Fasthorse Creations",
  description:
    "Our policy on cancellations, returns, exchanges, and what to do if your order arrives damaged, defective, or melted.",
};

export default function ReturnsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Returns &amp; Refunds Policy
      </h1>
      <p className="mt-2 text-sm text-ink/60">Last updated: July 24, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/80">
        <section>
          <p>
            Thank you for shopping with us. We&rsquo;re always happy to help
            find a fair solution if something&rsquo;s wrong with your order, but
            because of the hygienic nature of cosmetics, we are not able to
            accept returns or exchanges. Every situation is handled on a
            case-by-case basis.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Cancellations and changes
          </h2>
          <p className="mt-2">
            You can cancel or change your order within 48 hours of placing it,
            as long as we receive the request before the order has shipped. If
            your order hasn&rsquo;t shipped yet, we can also update your mailing
            address or email address if either was entered incorrectly.
          </p>
          <p className="mt-2">
            We do not offer refunds once an order has shipped, due to the nature
            of the product.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Damaged, defective, or missing products
          </h2>
          <p className="mt-2">
            If any part of your order arrives damaged, defective, or is missing,
            email <SupportEmailLink /> with photos of the package and the
            damaged or defective contents. If something&rsquo;s missing, include
            a photo of what you did receive.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Melted or deflated body butter
          </h2>
          <p className="mt-2">
            If your body butter arrives melted, that&rsquo;s normal &mdash; we
            only use natural preservatives. Screw the lid on tight, give it a
            good shake, and put it in the fridge. It&rsquo;s still perfectly
            usable even after it has deflated or been refrigerated. If
            you&rsquo;d like the fluffy texture back, simply blend it and return
            it to its container.
          </p>
          <p className="mt-2">
            We don&rsquo;t offer refunds or exchanges for melted product. Please
            email us with your name, order number, and photos of the package at{" "}
            <SupportEmailLink />.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            All sales are final
          </h2>
          <p className="mt-2">
            While we&rsquo;ll always work with you to resolve an issue, our
            official store policy is that all sales are final.
          </p>
        </section>
      </div>
    </div>
  );
}
