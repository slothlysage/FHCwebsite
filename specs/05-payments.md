# 05 — Payments

## Model

Stripe **Checkout**, hosted. The customer leaves the site to pay and returns.
Card details never touch our servers, which keeps PCI scope at SAQ-A. This is
the right trade for a small store: less control over the checkout look, far less
liability.

## Source of truth

- **Catalog and inventory: our database.**
- **Payment status: Stripe.**

Never derive one from the other in the wrong direction.

## Sync

Each active `product_variant` maps to a Stripe Price under a Stripe Product.
`stripe_price_id` is stored back on the variant.

Prices in Stripe are **immutable**. A price change creates a new Price, points
the variant at it, and archives the old one. Do not attempt to mutate.

Sync must be idempotent: keyed on our variant id via Stripe metadata, so
re-running creates nothing new.

## Checkout session

1. Load the server-side cart by cookie.
2. Re-fetch every variant from the database. Re-check `is_active` and stock.
3. Build `line_items` from **database prices**, not from anything the client
   sent. The client sends variant ids and quantities and nothing else.
4. Apply shipping options and enable Stripe Tax.
5. Set `metadata: { cart_id, order_draft_id }` so the webhook can correlate.
6. Set `success_url` with `{CHECKOUT_SESSION_ID}` and a `cancel_url`.
7. Set an idempotency key so a double-click doesn't create two sessions.

**Mandatory test:** a request whose payload includes a `price` or `total` field
produces a session with the correct server-derived amount. If the code even
reads a client price, that is a failure regardless of the assertion.

## Webhooks

Endpoint: `POST /api/webhooks/stripe`. Raw body — Next.js must not parse it
before signature verification.

Handled events:

| Event                           | Action                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `checkout.session.completed`    | create order, decrement inventory, empty cart, send receipt |
| `payment_intent.payment_failed` | log, leave draft unpaid, do not decrement stock             |
| `charge.refunded`               | set order refunded/partially refunded, optionally restock   |
| `charge.dispute.created`        | flag order, notify owner                                    |

Everything else: log and return 200.

### Idempotency

Insert `event.id` into `webhook_events` **first**. A unique-constraint violation
means we've seen it — return 200 immediately and do nothing else. Only after a
successful insert do we process. Stripe retries, and it also delivers
out of order; both must be harmless.

### Ordering

`checkout.session.completed` can arrive before or after other events for the same
payment. Handlers must be written so that arrival order doesn't matter — check
current state before transitioning rather than assuming.

### Transactions

Order creation, order items, inventory movements, and cart clearing happen in one
database transaction. Email is sent **after** commit; a failed email must never
roll back a paid order.

## Oversell

Re-check stock at session creation _and_ at webhook time. If stock is gone by
the time payment lands, the order is created in a `needs_attention` state and the
owner is notified — we do not silently refund, because a hand-made business often
can make one more. See `specs/04-admin.md`'s "Owner notifications" section for
how that notification is delivered (in-app dashboard list + best-effort email).

## Testing

- Unit: `stripe-mock` or recorded fixtures. Never call live Stripe.
- Webhook: construct events with `stripe.webhooks.generateTestHeaderString` so
  signature verification is genuinely exercised.
- E2E: Stripe CLI `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- Test cards: `4242424242424242` success, `4000000000000002` decline,
  `4000002500003155` 3DS required, `4000000000009995` insufficient funds.

## Implementation notes (3.1)

`src/lib/stripe/client.ts` exports a module-scope singleton `stripe`
(`new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })`) plus
the exported `STRIPE_API_VERSION` constant itself (`"2026-06-24.dahlia"`,
matching the installed `stripe@22.3.2` SDK's own compiled default —
`node_modules/stripe/cjs/apiVersion.d.ts` — so request/response typings stay
in sync with the pinned string). Pinned explicitly rather than left to float
to the Stripe account's dashboard-configured default, so an unannounced
Stripe-side API upgrade can't silently change request/response shapes under
us.

The live-mode interlock (AGENT.md: "Never touch Stripe live mode") is a
plain guard function, `assertNotLiveModeUnlessAllowed(secretKey, allowLive)`,
called once at module load before constructing the client: throws if the key
starts with `sk_live_` and `env.ALLOW_LIVE` is not `true`. This reuses 0.4's
existing `ALLOW_LIVE` boolean from `src/lib/env.ts` — no new env var needed.

Test pattern follows `src/lib/env.test.ts` exactly: `vi.resetModules()` +
reassigning `process.env` + dynamic `import("./client")` per case, since both
`env.ts` and `client.ts` parse/construct at module load, not lazily. 5 unit
tests in `src/lib/stripe/client.test.ts`: test-key succeeds, live-key with
`ALLOW_LIVE` unset throws naming `ALLOW_LIVE`, live-key with
`ALLOW_LIVE=false` throws, live-key with `ALLOW_LIVE=true` succeeds, and the
exported `STRIPE_API_VERSION` matches a `YYYY-MM-DD...` shape. No network
call is made by any of these — constructing a `Stripe` instance never
contacts the API, so no mock/fixture is needed for this task specifically;
3.2+ (catalog sync, checkout sessions) are what will need `stripe-mock` or
recorded fixtures per the Testing section above.

NOTE for 3.2+: import `{ stripe }` from `@/lib/stripe/client`, don't
construct a second `new Stripe(...)` anywhere else — that would defeat the
interlock and the pinned version for whichever call site skipped it.

## Implementation notes (3.2a)

`src/lib/services/stripe-sync.ts` — `planVariantSync(variant, currentPrice)`
is the entire pure decision layer for catalog → Stripe sync, split out from
the Stripe-API-calling apply step (3.2b) the same way `catalog-importer.ts`'s
pure parser was split from `catalog-import.ts`'s DB-writing apply step (1.4a/
1.4b). No Stripe SDK import, no DB import — so this sub-task needed no mocking
infrastructure at all (no `stripe-mock`, no msw, nothing), unlike 3.2b which
will.

Inputs: `variant: { priceCents, isActive, stripePriceId }` (the three
`product_variants` columns this decision needs) and `currentPrice:
{ unitAmount, active } | null` — the live Stripe Price for
`variant.stripePriceId`, which 3.2b is responsible for fetching before calling
this function. `currentPrice` is meaningless (and ignored) when
`stripePriceId` is `null`.

Returns exactly one of four actions:

- `skip` — variant is inactive. 3.2 only syncs active variants; an inactive
  one is left alone entirely, synced or not.
- `create` — no `stripePriceId` yet, **or** one is set but `currentPrice` is
  `null` (the Stripe object couldn't be found — e.g. deleted out-of-band).
  Both cases mean "no usable existing Stripe Product/Price to build on",
  so 3.2b should create a fresh Product + Price in both.
- `replace` — `stripePriceId` is set, a `currentPrice` was found, but it no
  longer matches: either `unitAmount !== variant.priceCents` (a real price
  change) or `currentPrice.active === false` (our stored id points at an
  already-archived Price — likely a previous sync that wrote the new price id
  but crashed before, or drift from a manual Stripe-dashboard edit). Either
  way 3.2b creates a new Price on the _same_ underlying Stripe Product
  (obtainable from the old Price's own `.product` field — no separate
  `stripe_product_id` column was added to the schema for this, see below) and
  archives the old one. Prices are immutable per this spec's Sync section —
  never mutate one in place.
- `noop` — `currentPrice` matches local state exactly (same amount, still
  active). Nothing to do. This is what makes running sync twice produce no
  duplicates: the second run finds every already-synced variant's
  `stripePriceId` set and its Stripe Price unchanged.

NOTE for 3.2b: deliberately no `stripe_product_id` column exists on
`products` (`specs/02-data-model.md` was not changed for this). Each variant
gets its own Stripe Product (one Price each), not one shared Product per our
`products` row with many Prices — this avoids needing any new schema field,
since the one Stripe object id this repo already persists
(`product_variants.stripe_price_id`) is sufficient: a Stripe Price object
carries its own Product id (`price.product`), so the `replace` action's
"same underlying Product" requirement is satisfiable by reading that field
off the already-fetched `currentPrice`, not by storing a second id locally.
3.2b's fetch step should keep that `product` id around (not discarded) for
exactly this reason.
NOTE for 3.2b: scope the variants fetched from the DB to active variants of
published, non-deleted products (mirrors `product-detail.ts`/
`product-listing.ts`'s existing "published, non-deleted only" contract) —
`planVariantSync`'s own `skip` branch only covers `is_active`, it has no way
to see product status, so that filter belongs in 3.2b's query, not here.
NOTE for 3.2b: this is also where the Stripe-mocking approach for this
repo's unit tests gets decided (none exists yet) — `stripe-mock`, recorded
fixtures, or msw intercepting `api.stripe.com`, per `AGENT.md`'s testing
rules ("Mock at the network boundary (MSW), not by stubbing your own
modules" and "use `stripe-mock` or recorded fixtures for unit tests").

## Implementation notes (3.2b)

`src/lib/services/stripe-catalog-sync.ts` — `runStripeSync(options, variants?)`
is the apply step: fetches each variant's current Stripe Price (when
`stripePriceId` is set), feeds both into 3.2a's `planVariantSync`, and
executes whichever action comes back. `variants` defaults to
`listActiveVariantsOfPublishedProducts()` (new `src/lib/repos/variants.ts`
function — active variants of published, non-deleted products, carrying
each product's name since a Stripe Product's display name is
`${productName} — ${variant.name}`) — that default is what
`scripts/sync-stripe.mts` (the real CLI, `npm run sync-stripe -- [--apply]`,
mirrors `import-catalog.mts`'s dry-run-by-default shape) actually uses. Tests
always pass an explicit `variants` array instead — see the mocking section
below for why that matters beyond just test scoping.

**Mocking approach: msw, with one real gotcha.** No `stripe-mock` binary and
no recorded fixtures existed in this repo; msw (already a candidate per
AGENT.md) was added as a devDependency. `tests/msw/stripe-server.ts` is a
small in-memory fake (`products`/`prices` Maps) covering the four endpoints
this module calls: `POST /v1/products`, `POST /v1/prices`,
`GET /v1/prices/:id`, `POST /v1/prices/:id` (Stripe's own "update" verb for
archiving). It also honors `Idempotency-Key` headers (an in-memory
key→response map) so tests can assert the idempotency-key design below
actually replays instead of re-creating.

Two non-obvious things had to be fixed to make msw work with the Stripe
Node SDK at all, both now baked into `src/lib/stripe/client.ts`:

1. **The SDK's default Node HTTP client is fundamentally incompatible with
   msw's `http.ClientRequest` interceptor.** `NodeHttpClient.makeRequest`
   (node_modules/stripe/cjs/net/NodeHttpClient.js) defers writing the
   request body until a `'socket'` event fires with `secureConnect` — msw's
   interceptor (`@mswjs/interceptors`, at least the version installed here)
   never emits that particular event on the request object, so the write
   never happens and the request hangs forever (confirmed by hand: identical
   raw `https.request` calls with the same options DID get intercepted
   correctly; only Stripe's own socket-deferred-write pattern hung). Fix:
   `client.ts` now constructs `new Stripe(key, { httpClient:
Stripe.createFetchHttpClient(), ... })` — msw's `fetch` interception has
   no such gap. This is also the right call independent of testing: Workers
   (this project's deploy target, 6.0) has no `http`/`https` modules at all,
   so a fetch-based client is what production needs there anyway.
2. **`FetchHttpClient` captures `globalThis.fetch` once, at construction
   time** (a plain variable assignment — see
   node_modules/stripe/cjs/net/FetchHttpClient.js — not a per-call lookup).
   Any test file that statically `import`s a module chain ending in
   `@/lib/stripe/client` gets the _pre-patch_ `fetch` baked into the
   singleton, because ES module imports always execute before that file's
   own code, including a `beforeAll` that calls `stripeServer.listen()`.
   Confirmed the hard way: an early version of `stripe-catalog-sync.test.ts`
   used a static top-level import and its "create" test came back with a
   real-looking Stripe object id (`price_1...`) — it had silently hit the
   real connected Stripe test-mode account instead of the mock. Fix, matching
   the pattern `src/lib/stripe/client.test.ts`/`env.test.ts` already use for
   load-time-side-effect modules: `vi.resetModules()` + a dynamic
   `await import("@/lib/services/stripe-catalog-sync")` **inside**
   `beforeAll`, after `stripeServer.listen()`.
   **Any future Stripe-calling module's test file must follow this same
   dynamic-import-after-`listen()` pattern** — a static import is silently
   wrong, not a compile error, and won't fail loudly; it just quietly calls
   the real API.

**Scoping the variants list matters for test safety, not just correctness.**
The real dev database already holds ~45 real catalog variants (1.4b/1.5's
import) with `stripePriceId: null`. `runStripeSync`'s default (calling
`listActiveVariantsOfPublishedProducts()` with no scope) syncs literally
every one of them. Before the dynamic-import fix above was in place, one
debugging run of the test suite executed that full, unscoped default against
the _real_ Stripe test-mode account, creating **51 real Products/Prices**
(45 real catalog + 6 test-named) before the bug was caught — and, on a
subsequent run (after the fetch fix but before the `variants` parameter was
added), overwrote those 45 real variants' `stripe_price_id` columns in the
local dev DB with fake `price_test_N` ids from the mock. Both were cleaned
up (DB columns reset to `null`; the 51 real Stripe objects are still in the
connected test account — pending owner decision, logged under "Blocked —
needs human"). This is why `runStripeSync` takes `variants` as an explicit
parameter rather than only ever querying the DB internally: every test in
`stripe-catalog-sync.test.ts` passes its own single created variant, so a
test run touches exactly the rows it created and nothing else in the shared
catalog — the same "don't assert/act against shared dev-DB global state"
lesson 2.2/2.4/2.6b's NOTEs already flagged, extended here to writes, not
just reads.

**Idempotency design.** `planVariantSync`'s `stripePriceId`-based
create/replace/noop decision is what makes a _clean_ re-run idempotent, but
it doesn't cover a crash between a Stripe write and the DB write-back that
records it. Every Stripe-object-creating call passes an explicit
`idempotencyKey` derived from `variant.id` (+ `priceCents` where the amount
is part of what must match for a safe replay): `variant-product-create-{id}`,
`variant-price-create-{id}-{priceCents}`, `variant-price-replace-
{id}-{priceCents}`. Combined with the write order chosen for `replace`
(create the new Price → archive the old one → write the DB) every crash
point self-heals on the next run to the same final state:

- Crash before the Stripe create: unchanged, retried as `replace` again.
- Crash after create, before archive: retry resubmits the same idempotency
  key (same object returned, not a duplicate), then archives.
- Crash after archive, before the DB write: retry sees the old Price is now
  `active: false` (still a `replace` per 3.2a's decision table), resubmits
  the same key (same new Price again), re-archives (no-op), writes the DB.
- Crash after the DB write: fully done; next run is `noop`.

`create` follows the same shape (product create, then price create, then
DB write), each step keyed the same way.

**Not run for real in this task.** `npm run sync-stripe` (dry run) was
hand-verified against the real dev DB — correctly reports all 45 real
variants as `[create]` with zero Stripe calls made (dry run only reads, and
none of them have a `stripePriceId` yet to retrieve). `--apply` was
deliberately **not** run against the real connected Stripe test account in
this task, unlike 1.4b's CSV import — creating real objects in a shared
external system the same way 1.4b's HUMAN GATE treated the first catalog
`--apply`. Whether to run it for real is the owner's call; see "Blocked —
needs human" for the exact state to decide against (51 stray test-mode
objects from the debugging incident above still need a decision either way).

## Implementation notes (3.3)

`src/lib/services/checkout.ts` — `createCheckoutSession(cartId, { idempotencyKey })`.
Deliberately takes only a `cartId` and a caller-derived `idempotencyKey`, no
line items, prices, or quantities — there is no parameter for a client to
put a tampered price/quantity/total into, which is what makes the "tampered
client payload" AC (this spec's "Checkout session" section) true by
construction rather than by validation. All pricing/availability comes from
`getCartSummary` (2.7's cart service), which already re-fetches every
variant, re-checks `is_active`/stock, and re-prices from the database
(specs/03-storefront.md's "3.5 (checkout) should call `getCartSummary`..."
note — that note predates the 3.3 split but the guidance still applies).

**Line items reference the synced Stripe Price, not `price_data`.** Each
line item is `{ price: line.stripePriceId, quantity: line.quantity }` — the
Price id 3.2's `runStripeSync` writes back onto the variant — rather than an
inline `price_data` block built from `line.priceCents`. This means the
amount actually charged is whatever Stripe has on file for that Price,
never a number this function computes or a client could reach, and it's why
3.3 depends on 3.2: **a cart line whose variant has no `stripePriceId` makes
checkout return `{ ok: false, reason: "unavailable" }` for the whole cart**
rather than falling back to an ad-hoc price. Operationally this means
`npm run sync-stripe -- --apply` must have been run for a variant before it
can actually be checked out — true of the real dev DB's catalog right now
(see "Blocked — needs human", the `--apply` step was deliberately not run
for real in 3.2b either).

**Shipping and tax.** No shipping-rate admin/config exists yet (that's
4.x's Settings page per specs/04-admin.md) — `checkout.ts` sends a single
flat `shipping_rate_data` option (`FLAT_RATE_SHIPPING_CENTS = 600`, US-only
via `shipping_address_collection.allowed_countries: ["US"]`). This is a
placeholder; **`specs/09-shipping.md` (task 3.3b) replaces it** with 2–3
static weight-banded `shipping_rate_data` options computed server-side from
the cart's total weight, not a live per-address Shippo call (Stripe
Checkout has no hook to quote a rate after the address is known — see that
spec's "Why checkout can't do live per-address rating"). Real, accurate,
per-shipment carrier rates are quoted and a label purchased later, at
fulfillment time in the admin (`specs/09-shipping.md`'s admin flow), where
the real destination address is already known. `automatic_tax: { enabled: true }` is sent
unconditionally — this also requires an "origin address" to be configured
in the Stripe Dashboard's Tax settings before a real (non-mocked) session
creation call will succeed; not something code can satisfy, logged under
"Blocked — needs human" as a launch prerequisite.

**Idempotency key, not derived from cart state.** `carts.updatedAt` is only
set at cart creation (nothing bumps it on `cart_items` changes), so it
can't distinguish "same checkout attempt, retried" from "same cart, tried
again a week later" — using it as the idempotency key would make every
checkout attempt for a given cart collapse into the first one, forever.
Instead: `src/lib/actions/checkout.ts`'s `createCheckoutSessionAction`
reads a `nonce` field from `formData` and builds the key as
`checkout-session-{cartId}-{nonce}`. The nonce itself comes from
`crypto.randomUUID()`, generated fresh by the cart page
(`src/app/(storefront)/cart/page.tsx`) on every render and embedded as a
hidden input in the Checkout form. Two submits of the _same_ rendered page
(a double-click) send the same nonce and collapse to one Stripe session; a
page reload, or a return trip after a cancelled/failed checkout, gets a new
nonce and a fresh session.

**The only trusted input from the client is that nonce.** `formData.get("nonce")`
is the single field `createCheckoutSessionAction` reads; `cartId` comes from
the httpOnly `cart_id` cookie via `readCartId()`, never from the form. A
POST to this action's endpoint with extra fields (`price`, `quantity`,
`total`, a spoofed `variantId`, ...) has those fields silently ignored —
tested directly in `src/lib/actions/checkout.test.ts`'s mandatory tamper
test, which submits exactly such a payload and asserts the resulting
session's line items match the real cart (server priceCents × server
quantity), not the submitted values.

**No `order_draft_id`.** This spec's "Checkout session" step 5 says
`metadata: { cart_id, order_draft_id }`, but no `order_draft` table or
concept exists anywhere in `specs/02-data-model.md` — orders (3.5) are only
created later, from the webhook, not at session-creation time. `checkout.ts`
sets `metadata: { cart_id: cartId }` only; 3.4/3.5 correlate the webhook's
`checkout.session.completed` event back to a cart via that one key.

**Mocking.** `tests/msw/stripe-server.ts` gained a
`POST /v1/checkout/sessions` handler (same in-memory-fake, same
Idempotency-Key replay behavior as the existing product/price handlers) and
a `getStripeFakeCheckoutSessions()` accessor. Bracket-notation array fields
(`line_items[N][price]`, `shipping_options[N][shipping_rate_data]...`) are
read via a small `extractIndexedColumn` helper — deliberately not a fully
generic bracket-notation parser, since (like the existing product/price
handlers) this fake only ever needs to read the handful of fields this
repo's code actually sends. Both `checkout.test.ts` and
`actions/checkout.test.ts` use the same dynamic-import-after-
`stripeServer.listen()` pattern as 3.2b's tests, for the same
`FetchHttpClient`-captures-`fetch`-at-construction-time reason.

**Not run for real in this task**, for the same reason 3.2b's `--apply`
wasn't: no real Checkout Session was created against the live-connected
Stripe test-mode account. Hand-verified instead against a real `next dev`
server with the real dev DB catalog (unsynced, per above): adding a real
item to the cart and submitting the real rendered Checkout form correctly
redirected to `/cart?checkout_error=unavailable` and rendered the banner —
proving the "no Stripe Price yet" guard works end-to-end without needing
`--apply` to have been run first.

## Implementation notes (3.4)

`src/app/api/webhooks/stripe/route.ts` is intentionally thin: read
`request.text()` (App Router Route Handlers never auto-parse the body —
there is no Pages-Router-style `api.bodyParser` to disable, so this raw read
already satisfies "Next.js must not parse it before signature
verification"), read the `stripe-signature` header, call
`src/lib/stripe/webhook.ts`'s `verifyWebhookSignature` then
`handleStripeWebhookEvent`, map to a `Response`. All the real logic — where
this repo's "webhook handlers" live per AGENT.md's layout — is in
`src/lib/stripe/webhook.ts` and a new `src/lib/services/
order-fulfillment.ts`.

**Idempotency, exactly as this spec's own section above describes**:
`insertWebhookEvent` (new `src/lib/repos/webhook-events.ts`) uses
`.onConflictDoNothing({ target: webhookEvents.stripeEventId })` and checks
whether `.returning()` actually came back with a row, rather than hand-
catching a raw Postgres `23505` unique-violation error — same result
(replay does nothing further), more idiomatic for a repo function callers
just get a boolean from.

**Dispatch, one handler per event type in the spec's table above**:

- `checkout.session.completed` → `fulfillCheckoutSession` (see below).
- `payment_intent.payment_failed` → log only. There is no `order_draft_id`
  (see this file's 3.3 notes) and therefore no row anywhere to mark unpaid
  — "log" is the entire correct handler, not a stub.
- `charge.refunded` → new `getOrderByStripePaymentIntentId` repo lookup,
  then `updateOrder(order.id, { status })` where `status` is `"refunded"`
  if the charge object's own `refunded` boolean is `true` (Stripe only sets
  this once the full amount is refunded), else `"partially_refunded"`. The
  spec's "optionally restock" is deliberately NOT implemented here — see
  fix_plan.md's NOTE for 4.8.
- `charge.dispute.created` → looks up the order the same way, but only
  logs (order id or "no matching order"). No schema mutation yet: the
  schema decision itself is now made — **`orders.disputed_at`, a nullable
  timestamp column** (like `paid_at`/`fulfilled_at`), decided 2026-07-23,
  not a `status` enum value, because a dispute is orthogonal to
  payment/fulfillment state (an order can be `paid` _and_ disputed, or
  `refunded` _and_ disputed) rather than replacing it the way
  `needs_attention` (3.6) does. See `specs/02-data-model.md`'s `orders`
  entry. Implementing the migration and setting the column here is still
  future work, not done in this task. The notification channel is also
  decided — see `specs/04-admin.md`'s "Owner notifications" — wiring this
  handler up to both is 4.6/4.9's job.
- anything else → `console.log` and fall through to `markWebhookEventProcessed`,
  satisfying "unhandled event type returns 200 and is logged."

**`fulfillCheckoutSession` (`src/lib/services/order-fulfillment.ts`)** is
new business logic, not folded into `webhook.ts` itself, matching
AGENT.md's "services/ = business logic, heaviest test target" — `stripe/`
dispatches, `services/` decides what a completed checkout actually does.
It re-derives order line items from `getCartSummary(session.metadata.cart_id)`
— the same read `createCheckoutSession` (3.3) used to build the original
Stripe line items — keeping the database the one source of truth for
catalog identity (product/variant names, SKUs). Money totals
(`subtotalCents`, `shippingCents`, `taxCents`, `discountCents`,
`totalCents`) are read directly off the Stripe session's own
`amount_subtotal`/`amount_total`/`shipping_cost.amount_total`/
`total_details.amount_tax`/`total_details.amount_discount` fields instead —
Stripe is the source of truth for payment amounts (AGENT.md), including
tax and shipping, both of which Stripe itself computed
(`automatic_tax`/`shipping_options`), not something to recompute
client-side from the cart a second time.

Order creation reuses `orders.createOrder` (1.3d — already one transaction
for the order + its items). Inventory is decremented per line via
`recordMovement({ reason: "sale", referenceId: order.id })`, and the cart is
emptied via a new `deleteCartItemsByCartId` repo function (deletes
`cart_items` rows only — the `carts` row itself survives, since the
`cart_id` cookie keeps pointing at it for the customer's next visit).

**Now one atomic transaction (task 3.5).** `fulfillCheckoutSession` wraps
the order+items insert, every line's inventory movement, and the cart-clear
in a single `withTransaction` call (`src/lib/repos/transaction.ts`, built
for exactly this in 1.4b) — a failure at any point (e.g. an inventory
movement write) rolls back the order and its items too, leaving no orphaned
rows. This is on top of, not instead of, 3.4's own AC ("replaying the same
event twice creates exactly one order and decrements inventory once"),
which still holds via `handleStripeWebhookEvent`'s `webhook_events`
event-id guard — `fulfillCheckoutSession` never runs twice for the same
Stripe event regardless of transaction boundaries.

`repos/orders.ts`'s `createOrder` gained a third, optional `executor`
parameter (`DbExecutor`, defaulting to `db`) so it can participate in a
caller's transaction instead of always opening its own: called with no
executor it still wraps its own order+items insert in `db.transaction`
(unchanged behavior, exercised by `orders.test.ts`'s existing atomicity
test), but called with a `tx` (as `order-fulfillment.ts` now does) it just
runs both inserts against that `tx` directly, participating in the
caller's transaction rather than nesting a second one. `recordMovement`
(inventory.ts) and `deleteCartItemsByCartId` (cart.ts) already accepted an
optional executor from earlier tasks, so no changes were needed there.

**Regression test:** `order-fulfillment.test.ts`'s "rolls back the order,
order items, and cart clear when the inventory movement write fails" spies
`recordMovement` to reject once, then asserts — via direct queries against
the real dev database — that the order was never created, stock is
unaffected, and the cart still has its item. Confirmed this test fails
against the pre-3.5 code (the order persisted despite the injected
inventory-write failure, since the four writes ran outside any shared
transaction) before making it pass. A real FK-violation (the technique
`orders.test.ts`'s own atomicity test uses) wasn't available here: by the
time a cart line reaches `fulfillCheckoutSession`, `getCartSummary` has
already re-verified the variant is real and active, so there's no
naturally-occurring bad value left to construct a genuine constraint
violation from at the inventory-movement step. Injecting the failure via a
spy on a real dependency call, then verifying real DB state afterward, is
the fault-injection technique used instead.

**Testing — no msw needed for any of this.** Unlike 3.2b/3.3's
Stripe-API-_calling_ code, nothing here makes an outbound Stripe request:
`verifyWebhookSignature` is pure local HMAC verification
(`stripe.webhooks.constructEvent`), and `fulfillCheckoutSession` only reads
the plain event object it's handed. Tests build real signed payloads with
`stripe.webhooks.generateTestHeaderString({ payload, secret:
env.STRIPE_WEBHOOK_SECRET })` against the real (dummy, `.env.local`)
webhook secret, exactly as this spec's own Testing section prescribes, and
call the exported `POST` from `route.ts` directly with a real `Request` —
same "invoke the handler and await it" pattern `products/page.test.tsx`
established for Server Components, extended to Route Handlers. Two
`stripe/webhook.test.ts` cases (a `charge.refunded`/`charge.dispute.created`
pair with a `null` `payment_intent`) exist specifically to clear
`src/lib/stripe/**`'s 90% branch-coverage floor, not as padding — without
them `paymentIntentIdOf`'s `: null` branch was never exercised.

## Implementation notes (3.6)

`orderStatus` (schema.ts) gained a seventh value, `needs_attention`
(migration `0003_mighty_killraven.sql`, `ALTER TYPE ... ADD VALUE` — additive,
expand-safe, no data migration needed). This is the state the spec's
"Oversell" section names: a non-backorder variant sold out between session
creation and payment landing. The order is still created and still counted
as paid — Stripe already captured the charge, and the spec is explicit that
this is not a silent refund — but its `status` is `needs_attention` instead
of `paid` so it's visibly distinct from a normal fulfillment until 4.9's
audit/orders dashboard gives the owner a real place to see it.

**Why "session creation" alone isn't enough.** `getCartSummary` (2.7b) already
re-checks stock and clamps quantity on every read, including the one
`createCheckoutSession` (3.3) does — but that only protects one cart against
itself. It says nothing about a second, entirely different cart that reads
the same "1 left" a moment later and also clamps to 1. Both checkouts can
complete payment; only at webhook/fulfillment time, when both try to claim
the same physical unit, does the conflict become detectable. Hence the spec's
"and again at webhook time."

**Making the webhook-time recheck itself race-free.** Naively re-reading
`getStockForVariant` inside `fulfillCheckoutSession`'s transaction doesn't
help by itself: two concurrent transactions can both read "1 in stock"
before either has committed its own decrement. `src/lib/repos/
inventory.ts`'s new `lockVariantStock(variantId, executor)` calls
`pg_advisory_xact_lock(hashtext(variantId))` — a session-level advisory lock
scoped to the current transaction, released automatically at commit or
rollback, no separate unlock call or lock table to clean up. A second
transaction trying to lock the same variant blocks until the first commits
(or rolls back), at which point its own stock re-read sees the first's
already-committed movement. `variant_stock` is a plain aggregate view, not a
table, so `SELECT ... FOR UPDATE` was not an option (Postgres rejects locking
clauses on aggregate queries) — the advisory lock is the standard substitute.

`fulfillCheckoutSession` locks every _distinct_ variant id in the cart, in
ascending sorted order, before re-checking any of them — not each variant
immediately before its own check. Fixed, cross-transaction-consistent lock
ordering is what rules out a deadlock between two carts that share two or
more variants in different orders (cart A: candle then soap; cart B: soap
then candle) — both transactions always acquire locks low-id-first, so
neither can end up waiting on a lock the other already holds while holding
one the other wants.

**Oversold math and the unexpected/expected split.** For each line,
`oversoldQuantity = max(0, requestedQuantity - stockAfterLock)`, written to
the new `order_items.oversoldQuantity` column (schema already had it, from
1.7, default 0, previously never actually computed by checkout — 3.4's own
NOTE flagged this as 3.6's job). A variant with `allowBackorder: true` is
made-to-order (1.7): an oversold quantity there is normal and legal, and does
**not** flag the order. Only `oversoldQuantity > 0` on a **non**-backorder
variant is "unexpected" and sets the whole order's status to
`needs_attention`. Inventory is still decremented by the full requested
quantity in every case (the ledger reflects what was actually sold, negative
or not) — the guard changes what the order is _labeled_, never what was
charged or shipped-in-principle.

**Owner notification is still just `console.error`,** same gap fix_plan.md's
"Blocked — needs human" already logs for `charge.dispute.created` (3.4) — no
real channel (email/SMS/dashboard) exists yet. Unlike disputes, though,
`needs_attention` did get a real schema value in this task, because the spec
named it explicitly; disputes remain unresolved because the spec only says
"notify owner" without naming a status.
**Channel design decided 2026-07-23** (see `specs/04-admin.md`'s "Owner
notifications" and fix_plan.md's resolved "Blocked — needs human" entry):
in-app dashboard list (primary, 4.6/4.9) plus a best-effort email via Resend
to the admin user's own address once auth exists, falling back to the
`ADMIN_EMAIL` env var until then. Wiring this handler up to that channel is
still 4.6/4.9's implementation job, not done in this task.

**Regression/concurrency tests** (`order-fulfillment.test.ts`): (1) a
backorder variant oversold by a single fulfillment call keeps `status: "paid"`
and records `oversoldQuantity` on the item — proves the "expected oversell"
path doesn't false-positive; (2) two carts for the same last unit of a
non-backorder variant, fulfilled via `Promise.all` (genuine concurrent
transactions against the real dev database, not a mocked race), end with
exactly one order `"needs_attention"` and one `"paid"`, the two items'
`oversoldQuantity` summing to exactly 1, and final stock at -1 (1 on hand,
2 sold). Confirmed both new tests fail for the right reason (both orders
`"paid"`, `oversoldQuantity` always 0) against the pre-3.6 code before
implementing the lock + recheck.

## Implementation notes (3.7)

**Success page reads, never writes.** `src/app/(storefront)/checkout/
success/page.tsx` looks up the order by `?session_id=` via the existing
`getOrderByStripeSessionId` — never by order id, so the URL never carries an
enumerable identifier. A missing order (webhook hasn't landed yet, or a bad
id) renders a "finishing up" message, not a 404/error — that race is
expected, not exceptional. Because the page has no write path at all, "a
refresh doesn't duplicate anything" holds by construction; there is nothing
to make idempotent.

**Receipt building is pure; sending is a thin, best-effort wrapper.**
`src/lib/services/receipt.ts`'s `buildOrderReceiptEmail(order, items)` takes
plain data and returns `{subject, html, text}` — no db/network access, kept
in `services/` for the 90% coverage floor since it's rendering money amounts.
`src/lib/email/send.ts`'s `sendEmail` is the only thing that talks to Resend,
and is written so it cannot throw: both the SDK's own `{error}` result and a
thrown exception are caught and turned into `{sent: boolean}`. Combined with
`order-fulfillment.ts` sending the receipt _after_ `withTransaction(...)`
resolves (never inside it), a failed or slow email can never roll back or
delay the paid order — matching this section's "Email is sent after commit;
a failed email must never roll back a paid order" both by ordering and by
the send path being unable to throw.

**Resend's fetch-binding differs from Stripe's, in tests' favor.** Stripe's
SDK (`src/lib/stripe/client.ts`) binds a fetch-based HTTP client at
construction time, which is why its msw-mocked tests (3.2b, 3.3) have to
import the module dynamically _after_ `stripeServer.listen()` — a static
import would construct the client, and thus capture `fetch`, too early.
Resend's SDK (confirmed by reading `node_modules/resend/dist/index.mjs`)
instead calls the bare global `fetch` inline inside `fetchRequest`, per
request, with no reference captured earlier — so `src/lib/email/client.ts`'s
singleton can be imported statically everywhere, tests included, with no
extra ceremony. Do not copy the dynamic-import workaround here; it isn't
needed and would just be dead complexity.

**Resend's SDK already catches network failures itself.** `fetchRequest`
wraps its own `fetch` call in a try/catch and returns `{error}` rather than
throwing on a network-level failure — meaning `sendEmail`'s outer catch
block (there for defense against a future SDK change, or a bug reading
`resend`/`env` itself) is unreachable through any msw-simulable path. It
shows as two uncovered lines in the coverage report; left in deliberately
(same "belt and suspenders" reasoning as `order-fulfillment.ts`'s own
try/catch around the whole receipt-send call) rather than deleted just to
close the gap.

**`RESEND_API_KEY`/`RESEND_FROM_EMAIL` promoted to required** in `env.ts`,
per 0.4's own note to do this once the module they gate is actually built.
`.env.local`/CI use placeholder values (`.env.local`'s
`RESEND_FROM_EMAIL=onboarding@resend.dev` is Resend's real no-verification-
needed sandbox sender, for local dev only) — see fix_plan.md's "Blocked —
needs human" for the production sender-domain gap this leaves open.

**Made-to-order note in the receipt.** Resolves 1.7's own NOTE ("order
confirmation email should probably tell the customer the item is made to
order"): any `order_items` row with `oversoldQuantity > 0` gets a
"Made to order — this item ships once it's ready" line, in both the html and
text bodies and on the success page itself.
