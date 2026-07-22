# 07 — Security, privacy, and legal

## Security

- Card data never touches our infrastructure (Stripe Checkout, SAQ-A).
- All input validated with zod at the boundary. Trust nothing from a client,
  including hidden fields and cookies.
- Drizzle's parameterized queries only. No string-built SQL, ever.
- CSP with a per-request nonce; `script-src` allowlists Stripe. No
  `unsafe-inline` for scripts. Also: HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, restrictive
  `Permissions-Policy`.
- Rate limit: login, checkout session creation, cart mutations, contact form.
- Uploads: validate by magic bytes not extension, cap size, strip EXIF, serve
  from R2 on a separate origin.
- Secrets only in the platform secret store. `.env.local` is gitignored. Rotate
  anything that ever lands in a commit — assume it is compromised.
- Dependabot on; `npm audit` in CI as a warning, not a hard fail (to avoid
  wedging the loop on an unfixable transitive advisory).

## Privacy

- Collect the minimum: email, shipping address, order contents.
- No customer passwords stored (guest checkout only) — one entire breach class
  eliminated.
- Cookieless analytics, so no consent banner is legally required in most
  jurisdictions. Do not add a tracker that changes this without telling the owner.
- Privacy policy states what is collected, why, retention, and how to request
  deletion.
- Sentry configured with PII scrubbing, and the scrubber is tested.

## Legal — flag to the owner, don't guess

The agent must not invent legal text. These are owner decisions:

- **Cosmetics (body butter):** in the US, MoCRA requires an ingredient
  declaration, a responsible-person contact, and adverse-event reporting. The
  data model reserves fields for these; the owner supplies the content.
- **Candles:** ASTM F2417 fire-safety labeling — burn instructions and warnings.
  These belong on the product page as well as the physical label.
- **Sales tax:** enable Stripe Tax and register where there's nexus. Stripe
  calculates; it does not decide where the owner is registered.
- **Shipping restrictions:** some carriers restrict flammable goods; check before
  offering international shipping.
- **Required policies:** shipping, returns, privacy, terms. Stripe requires
  visible contact and refund policy information.
- **Accessibility:** WCAG 2.1 AA is the target — both the right thing and the
  main source of US retail-site litigation.

None of this is legal advice; it's a checklist of things to confirm with someone
qualified before launch.
