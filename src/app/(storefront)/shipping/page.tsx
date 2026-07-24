import type { Metadata } from "next";

import { SupportEmailLink } from "@/components/support-email-link";

export const metadata: Metadata = {
  title: "Shipping Policy | Fasthorse Creations",
  description:
    "Processing times, carriers, and what happens if a shipping address is wrong or a package is lost or stolen.",
};

export default function ShippingPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Shipping Policy
      </h1>
      <p className="mt-2 text-sm text-ink/60">Last updated: July 24, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/80">
        <section>
          <h2 className="text-lg font-semibold text-ink">Processing times</h2>
          <p className="mt-2">
            Our guaranteed processing time is 3&ndash;7 business days &mdash;
            day 1 starts the day after your order is received. Most orders
            actually process and ship within 1&ndash;5 business days, but to
            manage expectations, we do not guarantee processing sooner than
            3&ndash;7 business days.
          </p>
          <p className="mt-2">
            Business days do not include holidays or weekends, and we do not
            ship on Saturdays or Sundays. Please allow one extra business day
            for processing after a holiday or a sale.
          </p>
          <p className="mt-2">
            A tracking number is emailed to you once your order has processed.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Carriers</h2>
          <p className="mt-2">
            Packages ship via USPS, FedEx, or DHL depending on your location.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Incorrect shipping information
          </h2>
          <p className="mt-2">
            You&rsquo;re responsible for making sure your shipping address is
            correct at checkout. If you catch a mistake, we&rsquo;re happy to
            change it for you within 48 hours after your order processes &mdash;
            additional shipping cost may apply.
          </p>
          <p className="mt-2">
            If a package is returned to us because of an incorrect or incomplete
            address, or because no one was available for delivery, you&rsquo;ll
            be responsible for the return shipping cost. We are not responsible
            for packages delivered incorrectly or lost due to incorrect or
            incomplete shipping information you provided, and no refunds are
            given if any part of the address was wrong.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Lost or stolen packages
          </h2>
          <p className="mt-2">
            We are not responsible for lost or stolen packages that show a
            confirmed delivery to the address entered for the order. If this
            happens to you, please reach out within 48 hours of the delivery
            reported by the shipping carrier.
          </p>
          <p className="mt-2">
            When you contact us, we&rsquo;ll confirm the delivery address, date
            of delivery, tracking information, and carrier for you to
            investigate. Every package is insured by the shipper up to the
            amount you spent with us; it&rsquo;s the buyer&rsquo;s
            responsibility to file the insurance claim with the shipper, but
            we&rsquo;ll help however we can.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Questions</h2>
          <p className="mt-2">
            Questions about an order should be sent to <SupportEmailLink />{" "}
            &mdash; please include your name and order number so we can look it
            up quickly.
          </p>
        </section>
      </div>
    </div>
  );
}
