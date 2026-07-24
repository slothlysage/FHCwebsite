import type { Metadata } from "next";
import Link from "next/link";

import { SupportEmailLink } from "@/components/support-email-link";

export const metadata: Metadata = {
  title: "Terms of Service | Fasthorse Creations",
  description:
    "The terms and conditions that govern your use of the Fasthorse Creations website and any purchases you make from us.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-ink/60">Last updated: July 24, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/80">
        <p>
          Throughout this site, &ldquo;we&rdquo;, &ldquo;us&rdquo;, and
          &ldquo;our&rdquo; refer to Fasthorse Creations. This website,
          including all information, tools, and services available on it, is
          offered to you, the user, conditioned on your acceptance of all terms,
          conditions, policies, and notices stated here.
        </p>
        <p>
          By visiting our site and/or purchasing something from us, you engage
          in our &ldquo;Service&rdquo; and agree to be bound by the following
          terms and conditions (&ldquo;Terms of Service&rdquo;,
          &ldquo;Terms&rdquo;), including any additional terms and policies
          referenced here. These Terms apply to all users of the site, including
          without limitation browsers, vendors, customers, and contributors of
          content.
        </p>
        <p>
          Please read these Terms carefully before using our website. If you do
          not agree to all the terms and conditions of this agreement, you may
          not access the website or use our Service.
        </p>
        <p>
          Any new features or tools added to the store are also subject to these
          Terms. We may update, change, or replace any part of these Terms by
          posting updates to our website; your continued use of the site after
          changes are posted means you accept those changes.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            1. Online store terms
          </h2>
          <p className="mt-2">
            By agreeing to these Terms, you represent that you are at least the
            age of majority in your state or province of residence, or that you
            have given us consent to allow a minor dependent to use this site.
          </p>
          <p className="mt-2">
            You may not use our products for any illegal or unauthorized
            purpose, nor may you violate any laws in your jurisdiction
            (including copyright laws) in using the Service.
          </p>
          <p className="mt-2">
            You must not transmit any worms, viruses, or code of a destructive
            nature. A breach or violation of any of these Terms will result in
            immediate termination of your access to the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            2. General conditions
          </h2>
          <p className="mt-2">
            We reserve the right to refuse service to anyone, for any reason, at
            any time.
          </p>
          <p className="mt-2">
            You understand that your content (not including payment information)
            may be transferred unencrypted and involve (a) transmission over
            various networks, and (b) changes to conform to technical
            requirements of connecting networks or devices. Payment card
            information is always encrypted, and is handled entirely by our
            payment processor, Stripe &mdash; it never touches our servers.
          </p>
          <p className="mt-2">
            You agree not to reproduce, duplicate, copy, sell, resell, or
            exploit any portion of the Service without our express written
            permission. Headings in this agreement are for convenience only and
            do not limit or affect these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            3. Accuracy, completeness, and timeliness of information
          </h2>
          <p className="mt-2">
            We are not responsible if information on this site is not accurate,
            complete, or current. Material on this site is provided for general
            information only and should not be relied on as the sole basis for
            any decision. Any reliance on this site&rsquo;s material is at your
            own risk.
          </p>
          <p className="mt-2">
            This site may contain historical information, which is necessarily
            not current and is provided for reference only. We may modify the
            contents of this site at any time, but have no obligation to update
            any information.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            4. Modifications to the Service and prices
          </h2>
          <p className="mt-2">
            Prices for our products are subject to change without notice. We
            reserve the right at any time to modify or discontinue the Service
            (or any part of it) without notice. We shall not be liable to you or
            any third party for any modification, price change, suspension, or
            discontinuance of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">5. Products</h2>
          <p className="mt-2">
            Certain products may be available exclusively online and may have
            limited quantities, subject to return or exchange only according to
            our{" "}
            <Link
              href="/returns"
              className="text-lavender underline hover:text-lavender-dark"
            >
              Returns &amp; Refunds Policy
            </Link>
            .
          </p>
          <p className="mt-2">
            We have made every effort to display product colors and images as
            accurately as possible; we cannot guarantee your device&rsquo;s
            display will be accurate. We reserve the right to limit sales of our
            products to any person, geographic region, or jurisdiction, to limit
            quantities offered, and to discontinue any product at any time. We
            do not warrant that the quality of any product purchased will meet
            your expectations.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            6. Accuracy of billing and account information
          </h2>
          <p className="mt-2">
            We reserve the right to refuse any order you place with us, and to
            limit or cancel quantities purchased per person, household, or
            order. If we cancel or change an order, we may attempt to notify you
            using the email and/or billing information provided at the time the
            order was made.
          </p>
          <p className="mt-2">
            You agree to provide current, complete, and accurate purchase
            information for all purchases made at our store, and to promptly
            update that information as needed so we can complete your
            transaction and contact you if necessary.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">7. Optional tools</h2>
          <p className="mt-2">
            We may give you access to third-party tools that we neither monitor
            nor control. You acknowledge that such tools are provided &ldquo;as
            is&rdquo; and &ldquo;as available&rdquo;, without warranties of any
            kind, and that any use of them is at your own risk and discretion.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            8. Third-party links
          </h2>
          <p className="mt-2">
            Certain content and services available through our Service may
            include materials from, or link to, third parties. We are not
            responsible for examining or evaluating third-party content and do
            not warrant or assume liability for any third-party materials,
            products, or services. Please review a third party&rsquo;s own
            policies before engaging in any transaction with them.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            9. User comments and feedback
          </h2>
          <p className="mt-2">
            If you send us comments, suggestions, or other submissions, you
            agree that we may, without restriction, edit, copy, publish, and
            otherwise use them in any medium. We are under no obligation to keep
            any comments confidential, compensate you for them, or respond to
            them.
          </p>
          <p className="mt-2">
            You agree your comments will not violate the rights of any third
            party, and will not contain unlawful, abusive, or obscene material.
            You are solely responsible for any comments you make and their
            accuracy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            10. Personal information
          </h2>
          <p className="mt-2">
            Your submission of personal information through the store is
            governed by our{" "}
            <Link
              href="/privacy"
              className="text-lavender underline hover:text-lavender-dark"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            11. Errors, inaccuracies, and omissions
          </h2>
          <p className="mt-2">
            Occasionally there may be information on our site that contains
            typographical errors, inaccuracies, or omissions related to product
            descriptions, pricing, promotions, shipping charges, transit times,
            and availability. We reserve the right to correct any such errors
            and to change or update information, or to cancel orders, if any
            information is inaccurate at any time without prior notice
            (including after an order has been submitted).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            12. Prohibited uses
          </h2>
          <p className="mt-2">
            In addition to other prohibitions set out in these Terms, you are
            prohibited from using the site or its content:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>for any unlawful purpose;</li>
            <li>
              to solicit others to perform or participate in unlawful acts;
            </li>
            <li>
              to violate any international, federal, state, or local regulations
              or laws;
            </li>
            <li>
              to infringe upon or violate our intellectual property rights or
              the intellectual property rights of others;
            </li>
            <li>
              to harass, abuse, insult, harm, defame, slander, disparage,
              intimidate, or discriminate;
            </li>
            <li>to submit false or misleading information;</li>
            <li>to upload or transmit viruses or any other malicious code;</li>
            <li>to collect or track the personal information of others;</li>
            <li>to spam, phish, pharm, pretext, spider, crawl, or scrape;</li>
            <li>for any obscene or immoral purpose; or</li>
            <li>
              to interfere with or circumvent the security features of the
              Service.
            </li>
          </ul>
          <p className="mt-2">
            We reserve the right to terminate your use of the Service for
            violating any of the prohibited uses.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            13. Disclaimer of warranties; limitation of liability
          </h2>
          <p className="mt-2">
            We do not guarantee, represent, or warrant that your use of our
            Service will be uninterrupted, timely, secure, or error-free, or
            that results obtained from the Service will be accurate or reliable.
          </p>
          <p className="mt-2">
            In no case shall Fasthorse Creations, our owners, employees,
            affiliates, agents, contractors, or suppliers be liable for any
            injury, loss, claim, or any direct, indirect, incidental, punitive,
            special, or consequential damages of any kind, including lost
            profits or lost revenue, arising from your use of the Service or any
            product procured through it, whether based in contract, tort, strict
            liability, or otherwise, even if advised of the possibility of such
            damages. Where a jurisdiction does not allow the exclusion or
            limitation of liability for consequential or incidental damages, our
            liability is limited to the maximum extent permitted by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            14. Indemnification
          </h2>
          <p className="mt-2">
            You agree to indemnify, defend, and hold harmless Fasthorse
            Creations and our owners, affiliates, partners, agents, and
            employees from any claim or demand, including reasonable
            attorneys&rsquo; fees, made by any third party due to or arising out
            of your breach of these Terms or your violation of any law or the
            rights of a third party.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">15. Severability</h2>
          <p className="mt-2">
            If any provision of these Terms is determined to be unlawful, void,
            or unenforceable, that provision will nonetheless be enforced to the
            fullest extent permitted by law, and the unenforceable portion will
            be severed from these Terms without affecting the validity of the
            remaining provisions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">16. Termination</h2>
          <p className="mt-2">
            Obligations and liabilities incurred prior to the termination date
            survive termination of this agreement. These Terms are effective
            unless and until terminated by either you or us. You may terminate
            at any time by ceasing to use our site.
          </p>
          <p className="mt-2">
            If, in our sole judgment, you fail to comply with any term of these
            Terms, we may terminate this agreement at any time without notice,
            and you will remain liable for all amounts due up to and including
            the date of termination.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            17. Entire agreement
          </h2>
          <p className="mt-2">
            Our failure to exercise or enforce any right or provision of these
            Terms does not waive that right or provision. These Terms and any
            policies posted by us on this site constitute the entire agreement
            between you and us regarding the Service, superseding any prior
            agreements or communications. Any ambiguity in interpreting these
            Terms will not be construed against the drafting party.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">18. Governing law</h2>
          <p className="mt-2">
            These Terms are governed by and construed in accordance with the
            laws of San Bernardino County, California, USA.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            19. Changes to these Terms
          </h2>
          <p className="mt-2">
            You can review the most current version of these Terms at any time
            on this page. We reserve the right, at our sole discretion, to
            update or replace any part of these Terms by posting changes to our
            website. It is your responsibility to check this page periodically;
            your continued use of the site after changes are posted constitutes
            acceptance of those changes.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            20. All sales are final
          </h2>
          <p className="mt-2">
            Our official store policy is that all sales are final. We are always
            happy to help resolve issues with an order &mdash; see our{" "}
            <Link
              href="/returns"
              className="text-lavender underline hover:text-lavender-dark"
            >
              Returns &amp; Refunds Policy
            </Link>{" "}
            for the specific cases (cancellations, damaged or defective
            products) where we can help.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            21. Contact information
          </h2>
          <p className="mt-2">
            Questions about these Terms of Service should be sent to{" "}
            <SupportEmailLink />.
          </p>
        </section>
      </div>
    </div>
  );
}
