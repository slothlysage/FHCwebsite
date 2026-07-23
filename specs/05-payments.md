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
can make one more.

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
