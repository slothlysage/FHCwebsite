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

### Implementation notes (4.1c — CSRF + cookies + login/logout + admin seed)

- **Login/logout are Server Actions, not Route Handlers**: `src/lib/actions/
admin-auth.ts` (`loginAction`, `logoutAction`), mirroring `src/lib/
actions/cart.ts`'s shape exactly — thin orchestration, all real logic in
  `src/lib/auth/**`. No login page exists yet (out of scope for this task;
  a future admin-screens task builds the actual `<form>`); these actions
  are tested by invoking them directly with a constructed `FormData`, the
  same pattern `cart.test.ts` established.
- **CSRF token generation lives in `src/lib/auth/csrf-token.ts`, not
  `csrf.ts`**: `src/proxy.ts` (see below) imports `generateCsrfToken` and
  runs in Next's Edge Runtime, which does not support `node:crypto` — a
  real `next build` flagged this the first time `generateCsrfToken` lived
  in the same file as `csrfTokensMatch` (which needs `node:crypto`'s
  `timingSafeEqual` for the constant-time comparison). `csrf-token.ts` uses
  only Web Crypto (`crypto.getRandomValues`) + `btoa`, portable across the
  Edge Runtime, Node, and Cloudflare Workers. `csrf.ts` keeps
  `csrfTokensMatch` (Node-only, used solely by the Server Actions, never by
  `proxy.ts`). Any future file reachable from `proxy.ts`'s import graph
  needs the same split if it wants a Node-only API.
- **`src/proxy.ts`, not `src/middleware.ts`**: this Next.js version
  (16.2.11) deprecated the `middleware.ts` file convention in favor of
  `proxy.ts` (same signature, exported function renamed `middleware` →
  `proxy`) — confirmed via a real build showing the deprecation warning,
  fixed by renaming rather than leaving known-deprecated code in a fresh
  codebase. Its only job so far is issuing the CSRF cookie
  (`CSRF_COOKIE_NAME`, `csrf-token.ts`) when a request to `/admin/**` or
  `/api/admin/**` doesn't already have one — this is what lets the _first_
  page render (before any form has ever been submitted) already have a
  token available to embed in a hidden field once a real login page exists.
  **Task 4.2 (route protection) extends this same file** with the
  auth-redirect check, rather than creating a second one — Next.js only
  runs a single `proxy.ts`/`middleware.ts` per app.
- **Session cookie**: `src/lib/auth/session-cookie.ts` mirrors `src/lib/
cart-cookie.ts`'s `next/headers` read/write/(now also delete, for
  logout) pattern exactly, same mocking strategy in tests. `secure` is
  `process.env.NODE_ENV === "production"`, not the spec's literal always-on
  `Secure` — `next dev` serves plain http locally and a hard-coded `Secure`
  cookie would silently never be stored by the browser, breaking local
  login entirely. Next sets `NODE_ENV` automatically for `dev`/`build`, so
  this needs no env var of its own.
  Session rotation on login revokes whatever token the browser presented
  (if any) **regardless of whether it was still valid** — `rotateSession`
  looks the old token up by hash and revokes it unconditionally, so an
  expired-but-present session cookie doesn't error the login flow, it's
  just silently replaced. This is what "expired-session path is tested"
  means for this task's slice of the original 4.1 AC (`admin-auth.test.ts`,
  "rotates an existing (even expired) session cookie into a new one on
  login") — a dedicated "check my own session" endpoint that would
  demonstrate an expired cookie being rejected on a _protected_ route
  doesn't exist yet; that's 4.2's job once there's a route to protect.
- **Admin seed script**: `scripts/seed-admin.mts` (`npm run seed-admin`),
  same CLI shape as `import-catalog.mts`/`sync-stripe.mts` — reuses
  `hashPassword`/`createAdminUser` rather than reimplementing, idempotent
  (a second run against an already-seeded `ADMIN_EMAIL` is a no-op, not an
  error). No dedicated test file, same precedent as the other two CLI
  wrappers — the underlying service/repo functions are already covered,
  and `tests/unit/ci-config.test.ts` catches a script/`package.json`
  mismatch generically.
- **Test-email collision gotcha**: `admin-users.test.ts`/`login.test.ts`
  both seed a literal `"owner@example.com"` row; `admin-auth.test.ts`
  originally did too and intermittently hit `admin_users_email_unique`
  because vitest runs test files in separate parallel workers against the
  same shared dev database. Fixed by generating a unique email per test run
  (`` `owner-${randomUUID()}@example.com` ``, matching the `randomUUID()`
  convention `orders.test.ts`/`opengraph-image.test.ts`/`sitemap.test.ts`
  already use for slugs/SKUs). Any future admin-auth test file should do
  the same rather than reusing a fixed email literal.

### Implementation notes (4.2 — route protection)

- **Extends `src/proxy.ts`, per 4.1c's own instruction, rather than adding
  a second middleware file** — Next.js only runs one. For any `/admin/**`
  path except the exact `/admin/login` exemption, and any `/api/admin/**`
  path, it reads the `admin_session` cookie straight off
  `request.cookies` (not `next/headers`'s `cookies()`, which only works
  inside a Server Action/Route Handler request context) and calls the
  existing `verifySession` (4.1b) directly. Invalid/missing → 307 redirect
  to `/admin/login` for pages, 401 JSON for API routes; valid → falls
  through to the existing CSRF-cookie logic unchanged.
- **Corrects a 4.1c assumption about the Edge Runtime.** 4.1c split
  `generateCsrfToken` (Web Crypto) out of `csrfTokensMatch` (`node:crypto`)
  into separate files because it believed `proxy.ts` ran in Next's Edge
  Runtime, which doesn't support `node:crypto`. This task imports
  `verifySession` — which pulls in both `node:crypto`'s `createHash` and a
  real database read — directly into `proxy.ts`, and a real `next build`
  compiles clean with no Edge Runtime warning. Next.js 16.2.11's own
  build-time static analysis
  (`node_modules/next/dist/build/analysis/get-page-static-info.js`)
  actually _throws_ if a Proxy file's segment config sets `runtime` at
  all, with the message "Proxy always runs on Node.js runtime" — in this
  Next version, Proxy (the `middleware.ts` successor) has no Edge Runtime
  option at all, full stop. Whatever caused 4.1c's original build error,
  it isn't this. The `csrf-token.ts`/`csrf.ts` file split is harmless and
  left as-is, but this removes the "must avoid node:crypto" constraint for
  any _future_ file reachable from `proxy.ts`'s import graph.
- **Route enumeration is a hardcoded list, not a filesystem walk, for
  now.** No real page files exist yet under `src/app/admin/**` or
  `src/app/api/admin/**` (those start landing at 4.3) — there's nothing on
  disk to walk. `src/proxy.test.ts`'s `PROTECTED_PAGE_PATHS`/
  `PROTECTED_API_PATHS` arrays mirror this doc's Screens section
  (dashboard, products, orders, settings) instead. Once those route
  directories exist, switch the test to a real directory scan (same idea
  as `tests/unit/ci-config.test.ts`'s script-existence check) so a newly
  added, forgotten-to-protect page is caught automatically rather than
  relying on someone remembering to extend the hardcoded array.
- **No login page exists yet.** `/admin/login` is exempted from the auth
  check (so login is reachable at all) but there's no `page.tsx` there —
  an unauthenticated visit currently 404s past the proxy's pass-through.
  Building the actual form is fix_plan task 4.2a, newly added.

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

### Implementation notes (4.3a — product validation schema + slug generation)

- **Slugify is shared, not reimplemented.** `src/lib/slugify.ts` is the one
  `slugify(text)` implementation in the codebase — extracted from what used
  to be a private `slugifyCategory` inside `catalog-import.ts` (1.4b). Both
  the CSV importer's category slugs and this Products screen's product
  slugs call the same function. Any future free-text-to-slug need should
  extend this module, not add a third copy.
- **Slug field contract**: `src/lib/validation/product-form.ts`'s
  `productFormSchema` treats a blank/whitespace-only `slug` submission as
  "not provided" (→ `undefined`), which is what triggers auto-generation
  downstream — it does not treat blank as a validation error. A
  non-blank slug must already match `slugify`'s own output shape (lowercase
  alphanumeric segments joined by single hyphens); this keeps a manually
  typed override collision-checkable against machine-generated slugs on
  equal footing, rather than needing a separate normalization step later.
- **Collision handling**: `src/lib/services/product-slug.ts`'s
  `generateUniqueProductSlug(name, {manualSlug?, excludeProductId?})` slugs
  `manualSlug ?? name`, then probes `getProductBySlug` and appends `-2`,
  `-3`, ... until it finds a slug with no row, or a row whose id equals
  `excludeProductId` (the product currently being edited, so re-saving
  without changing the name doesn't manufacture a `-2` of itself). This is
  the only slug-uniqueness authority for the editor — 4.3c's create/edit
  Server Action should call it rather than checking `getProductBySlug`
  inline.
- **Both modules are DB/Node-boundary-clean where it matters**:
  `product-form.ts` is pure zod (no Node APIs), so it's safe to import from
  a future client-side form component for inline validation as well as the
  server-side action. `product-slug.ts` does hit the database (via the
  products repo) and is server-only, same as any other `src/lib/services/**`
  module.

### Implementation notes (4.3b — admin products list page)

- **Search matches name OR any variant SKU**, not just name. `src/lib/repos/
products.ts`'s `listProducts` gained a `search` option: a case-insensitive
  substring match against `products.name`, OR-ed with an EXISTS subquery
  matching any of the product's variants' SKUs — an owner looking a product
  up on this screen rarely knows which of the two they have on hand.
- **`listVariantsByProductIds` (`src/lib/repos/variants.ts`) returns every
  variant, active or not** — deliberately a new function rather than an
  overload of the existing `listActiveVariantsByProductIds` (3.2b's Stripe
  sync scope), since this list needs to show every SKU a product has, not
  just its currently-sellable ones.
- **No pagination/sort/facets in `admin-product-filters.ts`**, unlike the
  storefront's `product-filters.ts` — this is a small, single-owner catalog
  list, not a public crawlable page. Status enum values are read off
  `productStatus.enumValues` (schema.ts) rather than re-listed.
- **No edit/detail links yet** — 4.3c (create/edit form) isn't built, so
  each row is plain text for now. No shared admin layout/nav either; the
  page stands alone, same precedent as 4.2a's login page.

### Implementation notes (4.3d — publish/unpublish + soft-delete actions)

- **Publish-gate logic lives in `src/lib/services/product-publish-gate.ts`**,
  a pure function (`checkPublishGate({product, images, variants})`, no DB
  access) that reports every failing requirement at once, not just the
  first — mirrors `catalog-importer.ts`'s "pure, unit-tested-directly
  service" precedent. The Server Action (`admin-products.ts`'s
  `publishProductAction`) owns fetching the product/images/variants and
  translating each `PublishGateFailure` into a plain-language sentence; the
  gate itself only returns typed failure codes.
- **`audit_log` writes are append-only** (`src/lib/repos/audit-log.ts`'s
  `createAuditLogEntry` — no update/delete function exists on purpose) and
  attributed via `src/lib/auth/current-admin.ts`'s `getCurrentAdminUserId()`,
  which resolves the session cookie to an admin id and returns `undefined`
  (not a throw) on a missing/invalid/expired session — losing attribution
  must never block the mutation itself, since `audit_log.admin_user_id` is
  nullable.
- **Publish/unpublish redirect back to the edit page** (not the products
  list) so the owner immediately sees the new status; soft-delete redirects
  to the list, since the product being edited is gone. All three
  `revalidatePath("/admin/products")` regardless, so the list's status
  filter stays fresh too.
- **Only soft-delete gets a confirmation dialog.** The Rules section below
  says "delete product, cancel order" require confirmation naming the
  record — publish/unpublish are reversible (toggle back any time) and
  deliberately don't get one. `product-status-actions.tsx`'s delete form
  uses a plain `window.confirm(...)` in `onSubmit`, `preventDefault()`ing
  if declined; there's no modal component in the codebase yet to reach for
  instead.
- **Bulk publish/unpublish (the Products screen line above) is still
  unbuilt** — 4.3d only wired the single-product actions on the edit
  screen. `publishProductAction`/`unpublishProductAction` already take just
  a `productId` each, so a future bulk-actions UI on the list page can loop
  a checkbox selection over the existing actions rather than adding new ones.

### Implementation notes (4.4a — variant CRUD on the product edit page)

- **Extends the product edit page, no new route** — same instruction 4.3c's
  own NOTE left for this task. `src/components/admin/variant-list.tsx`
  (Server Component) renders below `ProductStatusActions`; each existing
  variant gets a native `<details>`/`<summary>` disclosure around its edit
  `VariantForm`, and one more `<details>` at the bottom always holds the
  create form. Plain HTML disclosure, not client-side show/hide state, is
  what lets the whole section (list + edit-in-place + create) stay a Server
  Component and keep working with JS disabled — same rationale 2.7c's cart
  forms used for Server Actions generally.
- **Money fields are entered in dollars, stored in cents.**
  `src/lib/validation/variant-form.ts`'s `priceCents`/`compareAtPriceCents`
  fields parse a `"24.99"`-shaped string and convert with the same
  `dollarsToCentsSchema` shape `product-filters.ts` already established for
  the storefront's price-range filter — not reimplemented a third way.
  `src/lib/format.ts`'s new `centsToDollarsInput(cents)` is the inverse, for
  pre-filling the edit form from a stored integer-cents value.
- **SKU uniqueness is checked proactively, not caught after a Postgres
  unique-violation.** `product_variants.sku` has a global `unique()`
  constraint; both `createVariantAction`/`updateVariantAction` call
  `getVariantBySku` first and return a per-field error if another variant
  already owns it (excluding the variant's own id on update, so resubmitting
  an unchanged SKU doesn't self-collide) — mirrors
  `generateUniqueProductSlug`'s own check-before-write shape, except a SKU
  collision is a real error surfaced to the owner, not something to
  auto-dedupe the way an auto-generated slug is.
- **No separate activate/deactivate action.** The spec's "active flag" is
  one field on the same create/edit form (a checkbox), not a toggle button
  like publish/unpublish — `updateVariantAction` covers flipping it, same as
  any other field change.
- **Stock is still not on this form** — deliberately deferred to 4.4b. The
  read-only summary row `variant-list.tsx` renders per variant is where a
  batch `getStockForVariants` lookup should land, and the adjustment form
  belongs inside the same per-row `<details>` this task added, not a new
  list or route.

## Implementation notes (4.4b — stock adjustment ledger UI)

- The adjustment form's `reason` select only offers `adjustment`/`damage`,
  a subset of the DB's full `inventory_reason` enum
  (`import`/`sale`/`refund`/`adjustment`/`damage`). The other three are
  always written by a system flow that already attributes its own reason
  (catalog import, checkout, a future refund handler) — a human at this
  form only ever means "I counted wrong" or "this got damaged/lost."
  `src/lib/validation/stock-adjustment-form.ts`'s `stockAdjustmentReasons`
  constant is the one place that list lives; extend it there, not by
  widening to the full DB enum, if a new manually-selectable reason is
  ever needed.
- `adjustStockAction` (`src/lib/actions/admin-inventory.ts`) is the only
  admin-facing write path onto `inventory_movements`, and it calls the same
  `recordMovement` (`src/lib/repos/inventory.ts`) that the catalog importer
  and order fulfillment already use — there is no `updateStock`/`setStock`
  function anywhere in the repo layer, so "stock is never edited directly"
  holds structurally, not just by convention.
- `variant-list.tsx`'s `stockByVariantId` prop follows
  `getStockForVariants`' "absent key means zero" contract, not "not found" —
  the edit page always calls it with every variant id up front (one batch
  query, not N), same pattern `product-listing.ts` established for the
  storefront.
- `audit_log.action` gained `"adjust_stock"` (`entityType: "variant"`,
  `before: {stock}`, `after: {stock, delta, reason, note}`), following the
  same naming convention as `create_variant`/`update_variant`/`publish`/
  `unpublish`/`soft_delete` — 4.6/4.9's timeline UI needs a human-readable
  line for this value alongside the existing ones, nothing structurally new.

## Implementation notes (4.5b — R2 storage client)

- `src/lib/storage/r2.ts` uses `aws4fetch` (`AwsClient` + `AwsV4Signer`), not
  `@aws-sdk/client-s3` — R2 is S3-compatible, but the full AWS SDK v3 is a
  heavy, Node-`crypto`-leaning dependency; `aws4fetch` is a zero-dependency,
  fetch-based SigV4 signer built specifically for Workers-compatible
  environments, matching the same fetch-based rationale as
  `src/lib/stripe/client.ts`. Endpoint shape:
  `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/<key>`,
  `service: "s3"`, `region: "auto"`.
- `getPresignedUploadUrl(key, contentType, expiresInSeconds?)` — query-string
  SigV4 signing (`signQuery: true`). The expiry must be set on the URL's
  `X-Amz-Expires` param _before_ signing, not passed as a signer option —
  `aws4fetch` only fills a default (86400s) when that param is absent from
  the URL; there is no `expires` constructor field. Default here is 900s.
  The signed `content-type` header must be sent byte-identical on the
  caller's actual PUT, or R2 rejects it as a signature mismatch.
- `putObject`/`getObject` are the server-side pair 4.5c's re-upload step
  needs (the processed responsive sizes from `image-upload.ts` don't exist
  until our server has already run sharp on the original, so they can't go
  through the presigned-URL path). Both fail loud (`response.ok` check) with
  the status and body text in the error rather than swallowing a non-2xx.
- All four exported functions call `getR2Config()` first, which throws
  listing every missing `R2_*` var by name if any of the five (`ACCOUNT_ID`,
  `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `BUCKET`, `PUBLIC_URL`) is unset —
  deliberate fail-loud, since these are `.optional()` in `env.ts`'s schema
  (so the app can boot without storage configured at all) but a call into
  this module with one missing is a config bug, not a runtime condition.
- `publicUrlForKey(key)` builds off `R2_PUBLIC_URL` (the bucket's public
  custom domain), not the `r2.cloudflarestorage.com` API endpoint — this is
  what gets written to `product_images.url`. Per `specs/07-security-legal.md`,
  images are deliberately served from a separate origin.
- **Open risk carried into 4.5c, not yet resolved**: whether `sharp` (4.5a's
  processing step) actually runs under the real `workerd` runtime this app
  deploys to (`@opennextjs/cloudflare`), not just Vitest's Node test
  environment — `next/og`'s `ImageResponse` already depends on sharp at
  request time as precedent, but sharp ships native `libvips` bindings and
  workerd has no native-addon support. Check this before wiring 4.5c's
  upload action calls `processUploadedImage` + `putObject` in a request
  handler; if it silently fails or falls back, the processing step needs to
  move somewhere with a real Node runtime instead.
- Test fixture: `tests/msw/r2-server.ts`, an in-memory fake keyed by object
  key, intercepting `PUT`/`GET` via a `RegExp` host pattern (the account id
  is part of the hostname, so a literal URL match doesn't work the way
  `tests/msw/stripe-server.ts`'s literal `api.stripe.com` match does).

## Implementation notes (4.5c — admin UI + upload wiring)

- `src/lib/actions/admin-images.ts` has two Server Actions, not one per
  CRUD verb: `uploadProductImageAction` (new file → 4.5a processing → 4.5b
  R2 upload → repo write) and `updateProductImagesAction` (batch alt
  text/position/delete over the existing set). Both end by calling
  `replaceProductImages` — the images repo's only write path is "replace
  the whole set" (see its own comment), so add/edit/delete/reorder all
  reduce to "fetch the current rows, compute the new array, replace" rather
  than adding per-row repo functions.
- **No drag-and-drop.** The task description says "drag-to-reorder
  position"; this implements reordering as a plain numeric `position` input
  per row plus one "Save images" submit instead. Literal HTML5 drag-and-drop
  has no keyboard equivalent and no library was already a dependency —
  AGENT.md requires every interactive component to ship keyboard support,
  and a numeric field is that for free. Revisit only if the owner
  specifically asks for drag interaction.
- **The edit form is field-named per image id** (`altText__<id>`,
  `position__<id>`, `delete__<id>`, see `product-images-form.ts`'s field
  name helpers), not by array index. `updateProductImagesAction` iterates
  its own `listImagesByProductId` result and reads each row's fields by the
  id it already trusts, rather than trusting a client-submitted id list —
  a forged extra row in the POST body can't inject an image that was never
  actually in the DB.
- **Only the "large" (1600px) responsive size is written to
  `product_images.url`.** The schema has one url/width/height per row, but
  4.5a's `processUploadedImage` produces three sizes. All three still get
  uploaded to R2 (`products/<productId>/<imageId>/<label>.webp`) so 5.4's
  future `srcset`/`<picture>` work can address them by the same naming
  convention without a re-upload; today's storefront components
  (`product-gallery.tsx`, `product-card.tsx`) only ever render a single
  `url` per image, so wiring a real `srcset` is deliberately out of this
  task's scope.
- **Deleting an image only removes its DB row, not its R2 objects.** There
  is no `deleteObject` in `r2.ts` yet (4.5b only added `putObject`/
  `getObject`, the pair 4.5c's re-upload step needed). A deleted image's
  three sizes become orphaned storage, not a correctness bug (nothing reads
  a row that no longer exists) but real waste over time. Logged in
  `fix_plan.md`'s Phase 5 as follow-up, not fixed here.
- **The 4.5b sharp/workerd risk is still open — worse, it's currently
  unverifiable in this sandbox for an unrelated reason.** Running
  `npm run preview` (the actual `opennextjs-cloudflare build` +
  `wrangler`/workerd path 6.0's own notes never got to exercise, since
  wrangler needed Node ≥22) now fails before it even reaches sharp:
  `ERROR Node.js middleware is not currently supported. Consider switching
to Edge Middleware.` This is `src/proxy.ts` (4.2's route protection),
  which 4.2's own notes already recorded as forced onto Node.js runtime by
  Next.js 16.2.11 itself ("Proxy always runs on Node.js runtime", no Edge
  Runtime opt-in exists anymore) — confirmed by reverting to `main` (pre-
  4.5c) and re-running the same `npm run preview`: identical failure, so
  this is not something 4.5c introduced. 6.0 was pulled ahead of 4.2 and
  only ever verified `opennextjs-cloudflare build` (which succeeds); nobody
  re-ran a real preview/deploy after `proxy.ts` started existing, and
  `npm run verify` doesn't include `preview` in its gate, so this regression
  shipped silently. **This means the site cannot currently reach Cloudflare
  Workers at all**, independent of whether sharp itself would work there —
  a strictly more urgent blocker than the original sharp question, and one
  that blocks 6.1 Staging deploy outright. New fix_plan task filed (see
  Phase 6).

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
