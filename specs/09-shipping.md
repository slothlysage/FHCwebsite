# 09 — Shipping labels and fulfillment

## Decision

| Concern        | Choice | Why                                                                                                                                              |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Label provider | Shippo | REST API + official fetch-based Node SDK; USPS (and other carriers) at Commercial Plus discounted rates; no monthly fee, pay per label purchased |

**Parcelcraft is ruled out, not just passed over.** Parcelcraft is a Shopify
app — it reads orders through Shopify's Admin API and has no public API of
its own for a non-Shopify storefront to call. Since `specs/00-overview.md`'s
entire premise is leaving Shopify, Parcelcraft cannot integrate with this
codebase at all, regardless of preference. Flagging this explicitly so a
future iteration doesn't waste time investigating it as an option.

Other options considered and rejected:

- **Pirate Ship** — free, no markup on USPS rates, and the owner may already
  know it from Shopify days. But it has no general-availability public API;
  it's a web dashboard with manual/CSV order entry. Not automatable from
  admin order-detail without the owner re-keying every order by hand, which
  defeats the point of building this into the site.
- **EasyPost** — a reasonable alternative, functionally comparable to
  Shippo (multi-carrier, pay-per-label, REST API). Shippo is chosen instead
  because its current TypeScript SDK is fetch-based rather than
  Node-http-based, which matters for this project's Cloudflare Workers
  deploy target (`specs/01-stack-and-hosting.md`, `specs/06-deploy` task
  6.0) the same way `src/lib/stripe/client.ts` had to force
  `Stripe.createFetchHttpClient()` for the same reason. Either would work;
  don't re-litigate this without a concrete Shippo blocker.

## Scope for v1 — read this before implementing

This is deliberately narrower than "full shipping integration":

**In scope:**

1. **Admin purchases a real USPS label when fulfilling an order.** The
   admin already has the real destination address (`orders.shipping_address_id`,
   collected by Stripe Checkout) and the real package weight (sum of the
   order's line items) at fulfillment time — this is the one place accurate,
   live carrier rates are actually usable.
2. **A small number of static, weight-banded shipping prices shown to the
   customer at checkout**, replacing the single `FLAT_RATE_SHIPPING_CENTS`
   placeholder (`specs/05-payments.md`, task 3.3). Still not a live Shippo
   API call — see "Why checkout can't do live per-address rating" below.

**Out of scope for v1 — do not build these without a spec update:**

- **Live, per-address rate shopping during Stripe Checkout.** Explained
  below; would require collecting the address on this site before
  redirecting to Stripe, which is a bigger UX change than this task.
- **International shipping.** Not enabled — `specs/07-security-legal.md`
  already flags that some carriers restrict flammable goods (candles), and
  international customs rules for wax/fragrance products need owner
  confirmation before this is ever turned on. `shipping_address_collection`
  stays `allowed_countries: ["US"]`.
- **Tracking-webhook-driven status updates** (auto-marking "delivered",
  proactive delay notifications). Shippo supports a tracking webhook; this
  is a reasonable v1.5, not v1 — the admin fulfillment flow's own tracking
  number/link is sufficient for a single owner-operator to hand-monitor at
  this order volume.
- **Multi-package / split shipments.** v1 assumes one label, one package,
  per order. A `shipments` table (not a single column on `orders`) is used
  specifically so this isn't a breaking change to add later — see the data
  model note below — but don't build the UI for it now.

## Why checkout can't do live per-address rating

Stripe Checkout Sessions are created with a fixed `shipping_options` array
_before_ the customer has entered an address on Stripe's hosted page —
there is no "call our server for a live rate once you have the address"
hook in Checkout. Getting genuinely live, per-destination Shippo rates in
front of the customer would require collecting their shipping address on
this site first, then creating the Checkout Session with that specific
rate baked in — a real UX change (an extra step before the Stripe redirect)
and a bigger scope than this task. Don't attempt a per-address live quote
inside `createCheckoutSession` — it can't work without that redesign.

The v1 compromise: 2–3 static, weight-banded flat rates (e.g. "under 1 lb",
"1–3 lb", "3+ lb"), each a plain `shipping_rate_data` amount the owner sets
by eyeballing Shippo's published USPS rate card for a representative
package in that band. This is strictly better than one flat number across
every order weight, costs nothing extra to compute (still evaluated
server-side from the cart's total weight before session creation, no
external API call in the checkout path), and keeps checkout exactly as fast
and failure-free as it is today. True live rating is a fine v2 if order
volume/weight variance ever makes the bands feel wrong — not needed yet.

## Provider client

`src/lib/shipping/client.ts` mirrors `src/lib/stripe/client.ts`'s pattern
(task 3.1) exactly, not a new pattern:

- A pinned Shippo API version if the SDK exposes one (check at
  implementation time; Shippo versions by header, not URL path — pin
  whatever the installed SDK defaults to, same rationale as
  `STRIPE_API_VERSION`: an unannounced provider-side upgrade must not change
  request/response shapes out from under this codebase).
- **Live-mode interlock, reusing `env.ALLOW_LIVE`** — no new flag. Shippo
  API tokens are prefixed `shippo_test_...` / `shippo_live_...`, directly
  analogous to Stripe's `sk_test_`/`sk_live_`. `assertNotLiveModeUnlessAllowed`
  from `stripe/client.ts` should become a small shared helper (or be copied
  verbatim with the token param renamed) rather than reimplemented with
  different logic — same rule, same phrasing, same AGENT.md citation.
- Fetch-based HTTP client, for the same two reasons `stripe/client.ts`
  documents: Cloudflare Workers has no `http`/`https` modules, and MSW's
  request interception (this project's mocking strategy, see Testing below)
  needs `fetch`, not Node's `http.ClientRequest`.

## Config: parcel defaults and ship-from address

Two values this codebase cannot derive from anything already in the
database, and must not guess:

- **`SHIP_FROM_ADDRESS`** — the owner's real return address. Needed on
  every rate request and label purchase. Same category of blocker as
  `specs/05-payments.md`'s Stripe Tax origin-address note — a Dashboard/config
  value only the owner can supply, not something to invent a placeholder
  for the way `FLAT_RATE_SHIPPING_CENTS` was (a wrong return address on a
  real purchased label is a real-world problem, not a cosmetic one).
- **`DEFAULT_PARCEL`** — the box/mailer the owner actually ships in
  (length/width/height + a fixed packaging-overhead weight). v1 assumes one
  default parcel size for every order, no per-order box-picking logic — a
  small handmade-goods shop with a handful of product types does not need a
  bin-packing algorithm. If the owner uses genuinely different box sizes for
  different order weights, that's a v1.5 "pick the smallest parcel that
  fits" enhancement, not a v1 requirement.

Both live in `src/lib/shipping/config.ts` as plain constants (same pattern
as `checkout.ts`'s `FLAT_RATE_SHIPPING_CENTS`) until Settings (04-admin.md)
grows a real form for them — do not build that form speculatively now.

**Package weight for a real order** = `sum(order_items.quantity ×
product_variants.weight_grams)` + `DEFAULT_PARCEL`'s packaging-overhead
grams. Shippo's parcel object accepts `mass_unit: "g"` directly — no unit
conversion needed, `weight_grams` (already in the schema, `specs/02-data-model.md`)
is usable as-is.

## Data model

See `specs/02-data-model.md`'s `shipments` table (added alongside this
spec) for the authoritative field list — don't duplicate it here and risk
drift. Summary of the shape and why:

- A **separate table, not columns bolted onto `orders`.** `orders` already
  has `fulfilled_at` (set when a shipment is recorded) — that's sufficient
  at the order level. Carrier/tracking/label/cost data lives in `shipments`
  for the same reason `inventory_movements` is a ledger and not a mutable
  stock column: purchasing a label is an event, and a mis-purchased label
  needs a **void** record, not a silently overwritten field. This also
  means a future multi-package order is additive (more rows), not a
  breaking schema change.

## Admin fulfillment flow (extends `specs/04-admin.md`'s Orders screen)

Replaces the plain "type in a carrier + tracking number" version of "mark
shipped" that `specs/04-admin.md` currently describes:

1. Order detail screen, on a `paid` order: **"Get shipping rates"** — calls
   Shippo's rates endpoint with `SHIP_FROM_ADDRESS` → `orders.shipping_address_id`
   → the computed parcel weight/`DEFAULT_PARCEL` dimensions. Returns a short
   list of carrier/service/price/eta options (Shippo already includes USPS
   by default for a US-to-US shipment; no extra carrier account setup
   needed for USPS specifically — that's Shippo's own carrier account under
   the hood).
2. Admin picks one (or the UI defaults to the cheapest) → **"Buy label"** —
   purchases the Shippo transaction for that rate. On success: writes a
   `shipments` row (carrier, service, tracking number, tracking URL, label
   URL, cost, Shippo's rate/transaction ids), sets `orders.status =
'fulfilled'`, `orders.fulfilled_at = now()`.
3. Writes an `audit_log` row (before/after), per `specs/04-admin.md`'s
   blanket "every mutation writes an audit_log row" rule — no exception for
   this one.
4. Sends the shipping-notice email with the tracking link — reuses task
   3.7's transactional email infrastructure (Resend), doesn't reimplement
   email sending.
5. Status-transition validation (existing rule in `specs/04-admin.md`):
   "Get shipping rates"/"Buy label" is only reachable from `paid`, matching
   the existing state-machine requirement that a refunded/cancelled order
   cannot be shipped.

**Voiding a wrongly-purchased label:** Shippo allows refunding an unused
label within a short window (typically 24-ish hours; USPS controls the
actual cutoff, not Shippo). The UI needs a "void label" action for exactly
this case — it requests the refund from Shippo and writes a **new**
`shipments` row with `status: 'voided'` referencing the original, rather
than deleting or mutating the purchased row. Ledger-style, matching
`inventory_movements`' own append-only convention — the audit trail should
show that a label was bought and then voided, not make it look like it
never happened.

## Testing

Same rules as Stripe (`AGENT.md`'s testing section, `specs/05-payments.md`'s
3.2b/3.3 implementation notes): **mock at the network boundary with MSW**,
not by stubbing the Shippo SDK's own methods. A new `tests/msw/shippo-server.ts`
alongside the existing `tests/msw/stripe-server.ts`, same in-memory-fake
shape (rates endpoint, transaction/label-purchase endpoint, refund endpoint).
Never call Shippo's real test-mode API from CI or the local test suite —
"never hit live Stripe" in `AGENT.md` extends to every external payment/
carrier API this codebase talks to, for the same reason: speed, determinism,
and not depending on a third party's uptime for `npm run verify` to pass.

`src/lib/shipping/**` should be held to the same 90% coverage floor as
`src/lib/stripe/**` and `src/lib/services/**` — money (label cost) and an
irreversible real-world action (a purchased, paid-for physical label) both
live here, matching AGENT.md's stated rationale for that higher bar.
Update `vitest.config.mts`'s `coverage.thresholds` to add `"src/lib/shipping/**"`
alongside the existing three when this is implemented.

## Legal / carrier restrictions — flag to the owner, don't guess

Cross-reference `specs/07-security-legal.md`'s existing "some carriers
restrict flammable goods" bullet: finished candles generally ship fine via
USPS ground/Priority domestically, but this needs the owner (or Shippo's
own docs/support) to confirm actual Hazmat classification for this specific
product line (soy vs. paraffin, fragrance oil flash points, etc.) before
international shipping is ever considered, and ideally before the first
real label purchase too. Add to `fix_plan.md`'s "Blocked — needs human"
list, don't decide this in code.

## Env vars

`SHIPPO_API_TOKEN` — added to `src/lib/env.ts`'s `serverSchema` as
`.optional()` at spec-writing time, promoted to required only when the
client (`src/lib/shipping/client.ts`) actually lands and imports it —
exactly the pattern task 0.4 already established for every not-yet-built
feature's env vars. Add the same commented placeholder to `.env.example`
as the other provider keys (`shippo_test_...`, with a comment that it must
stay test-mode until `ALLOW_LIVE=true`, matching `STRIPE_SECRET_KEY`'s
comment).

## Implementation notes (3.3b)

Lives entirely in `src/lib/services/checkout.ts` — no new module, no
`src/lib/shipping/**` directory yet (that's 4.7a's Shippo client, a
separate later task; this one needs no Shippo API call at all, per the
in-scope list above). `SHIPPING_BANDS` is a 3-entry array of
`{ maxWeightGrams, amountCents, displayName }`, ordered ascending by
ceiling; the last entry's `maxWeightGrams: null` means "no upper bound" so
it always matches, which is also what keeps `selectShippingBand` a total
function (`Array.find(...)!)` rather than needing a throwing fallback
branch that `npm run verify`'s coverage gate could never actually exercise).

Placeholder band prices set at implementation time (all owner-editable
constants, flagged in `fix_plan.md`'s "Blocked — needs human" pending real
numbers off Shippo's published USPS rate card):

| Band       | Ceiling    | Price  |
| ---------- | ---------- | ------ |
| under 1 lb | ≤454g      | $5.00  |
| 1-3 lb     | ≤1361g     | $8.00  |
| 3+ lb      | no ceiling | $12.00 |

**Total cart weight, not per-line.** `createCheckoutSession` sums
`line.weightGrams * line.quantity` across every `CartLine` in the same loop
that already builds Stripe line items and checks `stripePriceId` — one
pass, no second iteration over `summary.lines`. `CartLine` (2.7's cart
service, `src/lib/services/cart.ts`) gained a `weightGrams` field (copied
straight from `product_variants.weight_grams`, already `NOT NULL` in the
schema) since nothing had exposed per-line weight to a reader before this
task needed it.

**Still exactly one `shipping_options` entry**, not 2-3 for the customer to
pick between — the band is resolved server-side from the real cart weight
before the Stripe session is created, matching how the flat rate it
replaces worked. `specs/09-shipping.md`'s "static, weight-banded... options"
phrasing describes the _set of bands the code can choose from_, not what's
shown to the customer at once; only the one matching band's
`shipping_rate_data` goes into the session Stripe hosts.
