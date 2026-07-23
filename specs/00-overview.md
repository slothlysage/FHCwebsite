# 00 — Overview

## What we're building

A bespoke storefront for a small handmade self-care brand currently on Shopify:
candles, body butters, and related products. Low order volume, high product
churn (seasonal scents), single owner-operator doing fulfillment by hand.

## Why leave Shopify

Cost per month at low volume, transaction fees, and the desire for a site that
looks like the brand rather than like a theme. The replacement must not be
_worse_ at the boring parts Shopify did for free: taxes, inventory, receipts,
PCI scope, and not losing orders.

## Non-goals for v1

Explicitly out of scope. Do not build these:

- Customer accounts and login (guest checkout, guest bookings, and
  Stripe-hosted subscription management only — see `specs/05b-billing-and-bookings.md`)
- Multi-currency
- Reviews, wishlists, loyalty points
- Blog / CMS
- Multi-admin roles and permissions (one admin account)
- Abandoned-cart recovery
- In-house appointment scheduling/calendar (bookings sell a fixed-price slot
  via Checkout; the owner arranges the actual time by email — see
  `specs/05b-billing-and-bookings.md`)

Each is a reasonable v2. Adding any of them in v1 is scope creep and should be
rejected by the agent.

**Amended 2026-07-22:** "Subscriptions or recurring billing" is no longer a
non-goal — membership tiers are in scope for v1, added via Stripe Billing.
See `specs/05b-billing-and-bookings.md` for the model. This does not reopen
"customer accounts and login": subscription self-service (upgrade/downgrade/
cancel/payment method) is handled entirely by Stripe's hosted Customer
Portal, reached by an emailed link, not a site login system.

## Success criteria

1. The owner can add a product and see it live without touching code.
2. A customer can find, filter, and buy a product on a phone.
3. Money is never wrong. Prices come from the database, totals from Stripe.
4. Orders are never lost, even if a webhook is delivered twice or late.
5. Test coverage >=80% globally, >=90% on payments and auth, all green.
6. Hosting bill under $10/month at expected volume.
