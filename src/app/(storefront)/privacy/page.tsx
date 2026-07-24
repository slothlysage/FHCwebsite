import type { Metadata } from "next";
import Link from "next/link";

import { SupportEmailLink } from "@/components/support-email-link";

export const metadata: Metadata = {
  title: "Privacy Policy | Fasthorse Creations",
  description:
    "What personal information we collect, why, how long we keep it, and how to request that it be deleted.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-ink/60">Last updated: July 24, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/80">
        <section>
          <p>
            This policy explains what personal information Fasthorse Creations
            collects when you use this website or place an order, why we collect
            it, how long we keep it, and how to ask us to delete it. We collect
            the minimum we need to fulfill your order and run the store &mdash;
            nothing more.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">What we collect</h2>
          <p className="mt-2">
            When you place an order, we collect your email address, shipping
            address, and the contents of your order. There are no customer
            accounts or passwords on this site &mdash; every order is placed as
            a guest, so we never hold a password for you.
          </p>
          <p className="mt-2">
            If you contact us directly (for example, about a shipping or returns
            issue), we&rsquo;ll also have whatever information you choose to
            send us, such as your name and order number.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Payment</h2>
          <p className="mt-2">
            Checkout is handled entirely by Stripe. We never see or store your
            full card number &mdash; it goes directly to Stripe, which processes
            it under its own privacy policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Cookies</h2>
          <p className="mt-2">
            This site uses one functional cookie, which stores a random
            identifier for your shopping cart so it&rsquo;s still there when you
            come back to the page. It doesn&rsquo;t identify you personally and
            isn&rsquo;t used for advertising or tracking. We don&rsquo;t
            currently run any analytics or advertising cookies on this site; if
            that changes, we&rsquo;re committed to a cookieless, non-tracking
            approach.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Email</h2>
          <p className="mt-2">
            We send order-related emails &mdash; receipts and shipping updates
            &mdash; through our email provider, Resend. We don&rsquo;t currently
            run a marketing newsletter or send promotional email.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            How long we keep it
          </h2>
          <p className="mt-2">
            We keep order records for as long as we reasonably need them for
            accounting, tax, and legal purposes, and to help with any returns,
            disputes, or customer service questions. We don&rsquo;t sell your
            information or share it with third parties for their own marketing.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Your rights and how to request deletion
          </h2>
          <p className="mt-2">
            You can email <SupportEmailLink /> at any time to ask what personal
            information we have on file for you, or to ask us to delete it.
            We&rsquo;ll honor deletion requests except where we&rsquo;re
            required to keep certain records (for example, for tax purposes).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            Changes to this policy
          </h2>
          <p className="mt-2">
            If we change how we handle personal information, we&rsquo;ll update
            this page. See our{" "}
            <Link
              href="/terms"
              className="text-lavender underline hover:text-lavender-dark"
            >
              Terms of Service
            </Link>{" "}
            for how changes to our policies take effect.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about this Privacy Policy should be sent to{" "}
            <SupportEmailLink />.
          </p>
        </section>
      </div>
    </div>
  );
}
