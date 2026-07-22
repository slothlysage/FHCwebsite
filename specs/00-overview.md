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

- Customer accounts and login (guest checkout only)
- Subscriptions or recurring billing
- Multi-currency
- Reviews, wishlists, loyalty points
- Blog / CMS
- Multi-admin roles and permissions (one admin account)
- Abandoned-cart recovery

Each is a reasonable v2. Adding any of them in v1 is scope creep and should be
rejected by the agent.

## Success criteria

1. The owner can add a product and see it live without touching code.
2. A customer can find, filter, and buy a product on a phone.
3. Money is never wrong. Prices come from the database, totals from Stripe.
4. Orders are never lost, even if a webhook is delivered twice or late.
5. Test coverage >=80% globally, >=90% on payments and auth, all green.
6. Hosting bill under $10/month at expected volume.
