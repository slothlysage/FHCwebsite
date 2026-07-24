# 04 — Admin portal

Single admin user. No roles, no invitations, no user management UI in v1.
The account is created by a seed script, and the password is changed on first
login.

## Auth

- Email + password, argon2id (`memoryCost` >= 19456, `timeCost` >= 2)
- Session token: 32 random bytes, base64url. Store **only** a SHA-256 hash.
- Cookie: `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 7-day expiry,
  rotated on every login
- Server-side revocation via `sessions.revoked_at`
- Rate limit: 5 failed attempts per 15 min per IP+email, then a 15-min lock
  recorded in `admin_users.locked_until`
- Timing-safe comparison; identical error message for "no such user" and
  "wrong password"
- CSRF: double-submit token on every mutating request
- Optional TOTP second factor — schema supports it; UI is v1.5

### Implementation notes (4.1a — password hashing + login core)

- **Argon2id via `hash-wasm`, not the native `argon2`/`@node-rs/argon2`
  packages.** `specs/01-stack-and-hosting.md` targets Cloudflare Workers
  (`@opennextjs/cloudflare`); Workers cannot load native N-API addons, only
  JS/WASM. `hash-wasm` is a pure-WebAssembly implementation that runs
  unchanged there. Params: `memorySize: 19456` KiB, `iterations: 2`,
  `parallelism: 1` — meets the spec's `memoryCost >= 19456`/`timeCost >= 2`
  floor (OWASP's paired recommendation for that memory/time combo is `p=1`).
  `src/lib/auth/password.ts`.
- **Storage format**: hash-wasm's own `outputType: "encoded"` PHC string
  (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), stored as-is in
  `admin_users.password_hash` — self-describing, so a future params change
  doesn't invalidate already-hashed passwords (old rows still verify with
  their own embedded params).
- **Timing-safe comparison, not `argon2Verify`**: hash-wasm's built-in
  `argon2Verify` re-hashes and compares the encoded strings with plain
  `===`, which is not constant-time. `verifyPassword` instead parses the
  salt/params out of the stored hash, re-derives a binary digest, and
  compares with `node:crypto`'s `timingSafeEqual` (available under
  `nodejs_compat`, `wrangler.jsonc`).
- **User-enumeration timing**: a login attempt against an email that
  doesn't exist still runs a full argon2id verify (against a fixed,
  precomputed dummy hash, real params, never a real credential) before
  returning `invalid_credentials` — so "no such user" and "wrong password"
  take the same wall-clock time, not just the same message.
  `src/lib/auth/login.ts`'s `DUMMY_HASH`.
- **Rate limiting is stored per-account, not per-IP+email**, despite the
  spec line above naming "IP+email" as the dimension: the schema's only
  counters are `admin_users.failed_attempts`/`locked_until` (no separate
  attempts-with-IP log table), and v1 has exactly one admin account, so
  per-account and per-(IP+that one email) collapse to the same thing in
  practice. `recordFailedLoginAttempt` does the increment-and-maybe-lock as
  one atomic SQL `CASE` update (not read-then-write), so two concurrent
  failed requests can't both read attempt 4 and neither trigger the lock —
  same pattern as `discount-codes.ts`'s `incrementDiscountCodeUsage`.
- **Expired-lock behavior**: once `locked_until` is in the past,
  `attemptLogin` clears it (and resets `failed_attempts` to 0) _before_
  evaluating the current attempt — so the account gets a fresh 5-attempt
  window rather than re-locking on the very next single failure forever.
  Not spelled out in the spec line above; this is the interpretation this
  implementation commits to.
- `src/lib/auth/login.ts`'s `attemptLogin(email, password)` returns
  `{ok:true, adminUserId}` or `{ok:false, reason: "invalid_credentials" |
"locked"}`. **Sessions, cookies, CSRF, and the actual login/logout HTTP
  routes are 4.1b** — this module is credential-check only, no cookie or
  request handling.

## Screens

**Dashboard** — orders needing fulfillment, low-stock variants, last 30 days
revenue, and an **internal notifications** list (see "Owner notifications"
below) surfacing `needs_attention` orders and disputes with an unread count.
Read-only summary; every number/notification links to the underlying record.

**Products** — table with search, status filter, and bulk publish/unpublish.
Editor: name, slug (auto with manual override), description (markdown),
ingredients, safety info, categories, attributes, images, variants.
Publish is blocked unless: at least one image with alt text, at least one active
variant with a price, and non-empty ingredients and safety info.

**Variants** — SKU, name, price, compare-at price, weight, active flag.
Stock is shown but not directly editable; adjusting stock opens an "adjustment"
form that writes an `inventory_movements` row with a required reason.

**Orders** — list (filter by status, search by order number or email) and
detail (items, snapshotted names and prices, totals, addresses, Stripe link,
timeline built from `audit_log`).
Actions: mark packed; **get shipping rates and buy a USPS label** via
Shippo (real carrier/service options quoted against the order's actual
address and weight, not a typed-in carrier/tracking pair — see
`specs/09-shipping.md`), which is what actually transitions an order to
`fulfilled` and records the tracking number/label; void a mis-purchased
label; cancel; refund (full or partial, with optional restock).

**Settings** — ship-from address and default parcel size (Shippo label
purchases, `specs/09-shipping.md`), tax settings pointer, discount codes,
store contact details, change password. Weight-banded checkout shipping
prices (the static tiers described in `specs/09-shipping.md`, replacing the
old single flat rate) are also owner-editable here rather than a code
constant, once this settings surface is built.

## Owner notifications

Decided 2026-07-23, resolving the gap `fix_plan.md` flagged for both the 3.4
dispute handler and the 3.6 oversell guard (both previously only
`console.error`). Two channels, both fed by the same trigger events
(`needs_attention` orders — 3.6 — and `charge.dispute.created` — 3.4, once
that handler gets a real status/column to key off):

- **In-app** — the Dashboard's notifications list (above). This is the
  primary channel and always fires; it needs no configuration and has no
  external dependency. Implemented alongside 4.6 (orders dashboard) / 4.9
  (audit log), since both already read the same order/audit data this list
  surfaces.
- **Email** — sent via Resend (3.7's existing infrastructure) as a
  best-effort supplement, not the record of truth (the in-app list is).
  Recipient address resolution, in order:
  1. The logged-in admin's own `admin_users.email`, once admin auth (4.1/4.2)
     exists to read it from.
  2. Until then, or if that lookup fails, the `ADMIN_EMAIL` env var
     (`.env.example`) — already reserved for the seed script's one-time admin
     bootstrap, and reused here as the notification fallback rather than
     introducing a second, overlapping env var.
  3. If neither resolves to an address, skip the email and rely on the
     in-app list — never block or fail the triggering webhook/order flow for
     a missing notification address.

A failed or skipped notification (either channel) must never roll back or
block the order/webhook transaction that triggered it, matching the
"email sent after commit" rule under Payments' Transactions section.

## Rules

- Every mutation writes an `audit_log` row with before/after JSON.
- Refunds are initiated through Stripe; the local order status is updated by the
  resulting webhook, never optimistically in the request handler. If the webhook
  never arrives, the order stays in a "refund pending" state that is visible —
  a stuck-but-visible state beats a wrong-but-confident one.
- Status transitions are validated by an explicit state machine, and the invalid
  transitions are unit tested.
- Destructive actions (delete product, cancel order) require confirmation that
  names the affected record.
