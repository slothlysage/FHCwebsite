import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { SupportEmailLink } from "@/components/support-email-link";

export const metadata: Metadata = {
  title: "FAQ | Fasthorse Creations",
  description:
    "Answers to common questions about processing times, shipping, order changes, returns, and melted body butter.",
};

const FAQ_ITEMS: Array<{ question: string; answer: ReactNode }> = [
  {
    question: "How long does processing take?",
    answer: (
      <>
        Our guaranteed processing time is 3&ndash;7 business days, starting the
        day after your order is received. Most orders actually go out in
        1&ndash;5 business days. Business days don&rsquo;t include weekends or
        holidays, and we don&rsquo;t ship on Saturdays or Sundays &mdash; see
        our{" "}
        <Link
          href="/shipping"
          className="text-lavender underline hover:text-lavender-dark"
        >
          Shipping Policy
        </Link>{" "}
        for details.
      </>
    ),
  },
  {
    question: "What carriers do you ship with?",
    answer: "We ship via USPS, FedEx, or DHL depending on your location.",
  },
  {
    question: "How do I track my order?",
    answer:
      "We email you a tracking number as soon as your order has processed.",
  },
  {
    question: "Can I change my shipping address after I order?",
    answer:
      "Yes, as long as you let us know within 48 hours after your order processes. Additional shipping cost may apply for the change.",
  },
  {
    question: "Can I cancel or change my order?",
    answer:
      "Yes, as long as the request reaches us within 48 hours of placing the order and before it has shipped.",
  },
  {
    question: "Do you accept returns or exchanges?",
    answer: (
      <>
        Because of the hygienic nature of cosmetics, we don&rsquo;t accept
        returns or exchanges, and our official policy is that all sales are
        final. If something arrived damaged, defective, or missing, see the next
        question &mdash; we handle those on a case-by-case basis. Full details
        are in our{" "}
        <Link
          href="/returns"
          className="text-lavender underline hover:text-lavender-dark"
        >
          Returns &amp; Refunds Policy
        </Link>
        .
      </>
    ),
  },
  {
    question:
      "My order arrived damaged, defective, or something's missing — what do I do?",
    answer: (
      <>
        Email <SupportEmailLink /> with photos of the package and the damaged or
        defective contents (or a photo of what you did receive, if
        something&rsquo;s missing).
      </>
    ),
  },
  {
    question: "My body butter arrived melted or deflated — is that normal?",
    answer:
      "Yes — it's normal because we only use natural preservatives. Screw the lid on tight, give it a shake, and refrigerate it. It's still perfectly usable, and you can blend it to restore the fluffy texture if you'd like.",
  },
  {
    question: "My package shows delivered but I never got it — now what?",
    answer: (
      <>
        Reach out within 48 hours of the delivery reported by the carrier.
        We&rsquo;ll confirm the delivery address, date, and tracking information
        for you, and help however we can &mdash; every package is insured up to
        the amount you spent, and filing the claim with the shipper is the
        buyer&rsquo;s responsibility.
      </>
    ),
  },
  {
    question: "Do you offer refunds?",
    answer:
      "Our official policy is that all sales are final, but we're always happy to work with you to find a fair solution — every situation is handled on a case-by-case basis.",
  },
  {
    question: "How can I reach you?",
    answer: (
      <>
        Email <SupportEmailLink /> with your name and order number and
        we&rsquo;ll get back to you.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Frequently Asked Questions
      </h1>

      <dl className="mt-8 space-y-8 text-sm leading-relaxed text-ink/80">
        {FAQ_ITEMS.map((item) => (
          <div key={item.question}>
            <dt className="text-base font-semibold text-ink">
              {item.question}
            </dt>
            <dd className="mt-2">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
