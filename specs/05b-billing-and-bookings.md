# 05b — Subscription boxes and bookings

Added 2026-07-22, amending `specs/00-overview.md`'s non-goals — see that
file's "Amended" note. Revised the same day after clarifying what
"subscriptions" actually means for this business: **recurring shipments of a
box of physical products** (e.g. "Monthly Candle Box"), not an abstract
access-tier membership. That distinction matters architecturally — a box
subscription must generate a real `orders`/`order_items` row and decrement
real inventory on every billing cycle, not just flip a status flag.

This spec extends `specs/05-payments.md`, it does not replace it: one-time
physical-goods Checkout (3.1–3.8) is unchanged and ships first. Read that
spec first; this one covers what's added on top: bookable 1:1 sessions and
recurring box subscriptions.

## Sequencing decision: v1 vs. v2, and why

**One-time Checkout (3.1–3.8) ships first, unchanged.** Bookings and box
subscriptions are both additive — nothing in Phase 3 needs to change to
support either later, because both are just more Stripe Price/Checkout
configurations hitting the same webhook endpoint.

Within that, the two new offering types split further by how they should be
sequenced against `specs/04-admin.md`'s Admin portal (Phase 4, not yet
built):

- **Bookings have no dependency on Phase 4.** A booking is a fixed-price,
  one-time sale of a slot — structurally identical to selling a physical
  product via Checkout, minus inventory. It can be built in the new phase
  below (3b), right after 3.1–3.8, with zero admin tooling.
- **Box subscriptions could naively seem to need Phase 4** (something has to
  let the owner say what's in this month's box), but the fix is the same one
  this codebase already used for the catalog itself: `scripts/import-catalog.mts`
  lets the owner manage the catalog via a CLI script, months before any admin
  CRUD UI (4.3) exists. Box contents get the same treatment — **fixed
  contents per plan** (a plan's box is the same list of variants every
  cycle), managed by a small CLI script, not a per-cycle curation UI. If the
  seasonal contents need to change, the owner (or the agent, on request)
  defines a new plan (e.g. "Fall Candle Box" superseding "Summer Candle
  Box") the same way a new product is added today — no schema or code change
  required. Per-cycle curation (a true "surprise box, different every
  month, same plan") is real added complexity and is explicitly **out of
  scope** unless requested later; don't build it preemptively.

This means box subscriptions, like bookings, can be sequenced in the new
phase below, after one-time Checkout, without waiting on Phase 4.

## Model

Same house rule as one-time payments: **Stripe Checkout, hosted**, for both
new offering types. `AGENT.md`'s "Stripe Checkout (hosted) + webhooks. Not
Payment Element in v1" is not offering-type-specific — it applies here too.

- Box subscriptions: Checkout Session in `mode: "subscription"`.
- Bookings: Checkout Session in `mode: "payment"` (a booking is a fixed-price,
  one-time sale of a slot — see "Bookings are not scheduling" below). This
  reuses the same Checkout/webhook infrastructure as 3.3/3.4, not a parallel
  system.

Subscription self-service (upgrade, downgrade, cancel, update payment method)
is Stripe's **hosted Customer Portal**, linked from the receipt email and the
account-lookup page below. No in-house subscription-management UI, no
password, no session cookie for customers — this is what keeps "no customer
accounts" true while still shipping subscriptions.

## Source of truth

Same split as `specs/05-payments.md`: **our database** is authoritative for
what plans/service types exist and their price; **Stripe** is authoritative
for subscription/payment status. Never derive one from the other in the wrong
direction.

## Data model additions

All money is integer cents, all timestamps `timestamptz`, all ids `uuid`,
matching `specs/02-data-model.md`'s conventions exactly — these tables belong
in that file once implemented; drafted here first since this spec is new.

### box_plans

`id, slug (unique), name, description, price_cents, interval ('month'|'year'),
stripe_price_id (nullable), stripe_product_id (nullable), is_active,
created_at, updated_at`

Mirrors `product_variants`' Stripe-sync shape: our row is the source of truth
for name/price, `stripe_price_id` is filled in by a sync step, Stripe Prices
are immutable — a price change archives the old Price and creates a new one,
exactly like `specs/05-payments.md`'s "Sync" section already requires for
product variants. Do not write a second, divergent sync mechanism for plans;
extend the existing one.

### box_plan_items

`box_plan_id → box_plans, variant_id → product_variants, quantity` (composite
PK on `box_plan_id, variant_id`, mirroring `product_categories`' shape).

**Fixed contents per plan** (see "Sequencing decision" above) — this is the
whole box "recipe," managed by a CLI script analogous to
`scripts/import-catalog.mts`, not a per-cycle curation UI. Changing what's in
next month's box for an _existing_ plan means editing this table (by script
or, once 4.3 exists, by admin CRUD); shipping a genuinely different box means
creating a new plan, not mutating this one out from under active
subscribers mid-cycle.

### subscriptions

`id, email, stripe_customer_id, stripe_subscription_id (unique), box_plan_id →
box_plans, status ('incomplete'|'trialing'|'active'|'past_due'|'canceled'|
'unpaid'), current_period_end, created_at, canceled_at`

`status` values are Stripe's own subscription statuses, stored verbatim, not
re-mapped to a house enum — re-deriving Stripe's state machine locally is how
these get out of sync. Updated only by webhook (see below), never guessed at
from the storefront.

No `customers` table is introduced (still consistent with
`specs/02-data-model.md`'s existing decision not to have one). `email` +
`stripe_customer_id` are enough to look up a subscriber for the
account-lookup page.

### orders gains `subscription_id` (nullable)

`orders.subscription_id → subscriptions, nullable` — a new nullable column on
the _existing_ table, not a parallel `box_shipments` table. A box's monthly
shipment is an order like any other (same `order_items`, same inventory
decrement, same admin fulfillment view), just one whose existence was
triggered by a recurring invoice instead of a Checkout cart. `null` means an
ordinary one-time-Checkout order, unchanged from `specs/05-payments.md`.
Reusing `orders` here is deliberate — it's what lets 4.6/4.7's orders
dashboard and fulfillment flow (`specs/04-admin.md`) work for box shipments
for free, with no subscription-specific admin screen needed.

### service_types

`id, slug (unique), name, description, duration_minutes, price_cents,
stripe_price_id (nullable), stripe_product_id (nullable), is_active,
created_at, updated_at`

E.g. "30-minute reading", "60-minute consultation." Same Stripe-sync shape as
`box_plans` and `product_variants`.

### bookings

`id, service_type_id → service_types, email, name, requested_notes,
status ('pending_schedule'|'scheduled'|'completed'|'cancelled'|
'refunded'), stripe_session_id (unique), stripe_payment_intent_id,
scheduled_at (nullable), created_at`

A booking is created `pending_schedule` by the webhook the moment payment
succeeds — matching `specs/05-payments.md`'s order-creation pattern exactly.
`scheduled_at` starts `null` and is filled in later (by the owner, by hand,
per "Bookings are not scheduling" below) — it is not collected at Checkout
time.

### Indexes to add

- `subscriptions (stripe_customer_id)`, `subscriptions (email)`,
  `subscriptions (status)`
- `orders (subscription_id)`
- `bookings (email)`, `bookings (status)`

## Bookings are not scheduling

Deliberately out of scope (`specs/00-overview.md`'s non-goals, amended list):
an in-house calendar, availability grid, or time-slot picker. A "bookable
service" in v1 is a fixed-price item sold via Checkout like any other
product — the customer pays for "a 30-minute reading," the confirmation email
says the owner will follow up by email to schedule the actual time, and the
owner does that by hand (or with whatever external calendar tool they
already use — out of this codebase's concern). `bookings.scheduled_at` exists
so the admin portal can record the agreed time once it's set, not so the
storefront can offer one.

If real self-serve scheduling is wanted later, that is a v2 spec of its own
(likely a third-party embed — Calendly, Cal.com — rather than building a
calendar from scratch) and should be proposed as a spec change first, per
`specs/00-overview.md`'s own non-goals process, not inferred from this note.

## Recurring box fulfillment

The first invoice for a new subscription is paid at Checkout — that's the
`checkout.session.completed` (subscription mode) row in the webhook table
below, which creates the `subscriptions` row but does **not** itself create
an order (Checkout's own line item already represents that first cycle's
intent; the order comes from the invoice event like every later cycle, so
there is exactly one order-creation code path, not a special-cased first
cycle).

Every cycle, including the first, Stripe fires `invoice.paid` with
`billing_reason: "subscription_create"` (first) or
`"subscription_cycle"` (every renewal). On **either** value, the handler:

1. Looks up the `subscriptions` row by `stripe_subscription_id` (from the
   invoice's `subscription` field) to get `box_plan_id`.
2. Reads that plan's `box_plan_items` — the fixed "recipe."
3. Re-checks stock per variant via the existing `getStockForVariants`
   (1.3c) and applies the exact same purchasability/oversell rule 1.7
   already established (`stock > 0 OR allow_backorder`) — a box subscription
   does not get a different oversell policy than a one-time order.
4. Creates one `orders` row (`subscription_id` set, `email`/
   `stripe_customer_id` from the subscription) + one `order_items` row per
   `box_plan_items` entry, and the matching `inventory_movements` rows — all
   in one transaction, reusing `specs/05-payments.md`'s 3.5 order-creation
   path, not a duplicate.
5. Idempotency is the same `webhook_events` insert-`event.id`-first
   mechanism as everything else — Stripe's invoice id is already unique per
   cycle, so replay creates no duplicate order.

If a box plan's contents ever include a variant that's since been
soft-deleted or deactivated, that is a data problem for the owner to fix in
`box_plan_items` (swap to an active substitute), not something the webhook
handler should silently paper over — log and flag the order
`needs_attention`, matching 3.6's oversell-guard philosophy of never
silently under-fulfilling.

## Checkout sessions

### Box subscriptions

1. Look up the plan by slug, re-fetch `price_cents`/`stripe_price_id` from
   the database — never trust a client-supplied plan id's price the same way
   `specs/05-payments.md` forbids trusting a client-supplied cart price.
2. Create session with `mode: "subscription"`, `line_items: [{price:
boxPlan.stripe_price_id, quantity: 1}]`.
3. `customer_email` prefilled if known; otherwise let Checkout collect it.
4. `metadata: { box_plan_id }` so the webhook can correlate.
5. `success_url`/`cancel_url` per `specs/05-payments.md`'s pattern
   (`{CHECKOUT_SESSION_ID}` in the success URL, not an internal id).
6. Idempotency key per session-creation request, same reason as one-time
   checkout: a double-click must not create two subscriptions.

### Bookings

Same shape as a one-time product Checkout session
(`specs/05-payments.md`'s "Checkout session" section), substituting the
service type's `stripe_price_id` for a variant's. No stock/inventory check —
`service_types` has no stock concept. `metadata: { service_type_id }`.

## Webhooks

Same endpoint as `specs/05-payments.md`: `POST /api/webhooks/stripe`. Same
raw-body-before-verification requirement, same insert-`event.id`-first
idempotency mechanism (`webhook_events`), same "handlers must not assume
arrival order" rule. This is one webhook handler gaining more event-type
branches, not a second endpoint.

New events to handle, added to the existing table in
`specs/05-payments.md`:

| Event                                                         | Action                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkout.session.completed` (subscription mode)              | create `subscriptions` row from the session's subscription id, status from Stripe. Does not create an order — see "Recurring box fulfillment"                      |
| `checkout.session.completed` (payment mode, booking metadata) | create `bookings` row, status `pending_schedule`, send "we'll be in touch to schedule" email                                                                       |
| `invoice.paid`                                                | create the cycle's `orders`/`order_items`/inventory rows from `box_plan_items` — see "Recurring box fulfillment"; fires for both the first cycle and every renewal |
| `customer.subscription.updated`                               | upsert `subscriptions.status`/`current_period_end` from the event payload                                                                                          |
| `customer.subscription.deleted`                               | set `subscriptions.status = 'canceled'`, `canceled_at = now()`                                                                                                     |
| `invoice.payment_failed`                                      | log; leave `subscriptions.status` as Stripe reports it (Stripe's own Smart Retries handles dunning — do not build a parallel retry system)                         |

`checkout.session.completed` already exists in `specs/05-payments.md`'s
table; the handler must branch on `session.mode` (`"payment"` vs
`"subscription"`) and, within `"payment"`, on whether `metadata.service_type_id`
is present (booking) or `metadata.cart_id` is present (physical-goods order)
— these are mutually exclusive, one Checkout session is never both.

## Account lookup (no login, still self-service)

A single storefront page, `/account` (or similar — naming is a 3.x-style
implementation detail, not fixed by this spec): customer enters their email,
the server looks up their `stripe_customer_id` by email, and — if found —
either redirects to a fresh Stripe Billing Portal session, or (if not found,
or as a defense against email enumeration) shows the same "if you have an
active subscription, check your email" message either way and sends a portal
link by email via Resend. This mirrors a magic-link pattern without
introducing password auth, sessions, or an `admin_users`-style table for
customers — deliberately not reusing `specs/04-admin.md`'s auth (that is
admin-only).

## Testing

Same rules as `specs/05-payments.md`'s "Testing" section (`stripe-mock` or
fixtures, never live Stripe, `stripe.webhooks.generateTestHeaderString` for
webhook signature tests, Stripe CLI for E2E). Additional mandatory tests:

- A `checkout.session.completed` event in `subscription` mode creates exactly
  one `subscriptions` row; replaying it creates no duplicate (same
  `webhook_events` idempotency mechanism as orders).
- `customer.subscription.deleted` arriving **before** the corresponding
  `checkout.session.completed` (Stripe does not guarantee order) must not
  crash — the handler either creates the row already-canceled or upserts
  correctly regardless of which arrives first. This is this spec's version
  of `specs/05-payments.md`'s "Ordering" requirement.
- A booking Checkout session's line item price is asserted server-derived
  from `service_types`, not client-supplied — the exact same "mandatory test"
  `specs/05-payments.md` requires for cart totals, applied to bookings.
- `invoice.paid` (either `billing_reason`) creates exactly one order with one
  `order_items` row per `box_plan_items` entry and matching
  `inventory_movements` rows; replaying the same invoice event creates no
  duplicate order. This is the box-subscription version of 3.4's mandatory
  replay test.
- A box plan whose `box_plan_items` includes a variant with insufficient
  stock and `allow_backorder = false` produces an order flagged
  `needs_attention`, not a silently short-shipped or crashing handler — the
  1.7/3.6 oversell rule applied to recurring fulfillment.

## Test cards

Same set as `specs/05-payments.md`. For subscription-specific flows, also
exercise `4000000000000341` (attaches but fails on first charge — validates
the `invoice.payment_failed` path without waiting for a real billing cycle).
