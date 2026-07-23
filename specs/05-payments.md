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
