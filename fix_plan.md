# fix_plan.md — FHCwebsite backlog

The agent works top-down. Pick the highest `[ ]` item whose deps are all `[x]`.
Each item has an **AC** (acceptance criteria) — the task is not done until the AC
is demonstrably true and `npm run verify` is green.

`🚦 HUMAN GATE` = stop, commit, and ask. Do not proceed.

---

## Phase 0 — Foundation

- [x] **0.1 Scaffold Next.js app**
      Deps: none.
      Next.js App Router + TypeScript `strict`, Tailwind, path alias `@/*`.
      AC: `npm run dev` serves a page; `npm run build` succeeds; `tsconfig.json` has
      `strict: true`, `noUncheckedIndexedAccess: true`.

- [x] **0.2 Test harness + coverage gate**
      Deps: 0.1.
      Vitest + RTL + jsdom, `@vitest/coverage-v8`. Thresholds per `AGENT.md`
      (80% global; 90% for `src/lib/services/**` and `src/lib/stripe/**`).
      Added `src/app/page.test.tsx` (RTL, asserts the heading renders) to prove
      the harness runs — 100% coverage on the only real source file so far.
      AC met: `npm run test:coverage` was verified to fail the global 80%
      threshold with a deliberately uncovered scratch file, then pass again once
      it was removed.
      `tsconfig.json`'s `exclude` no longer drops `vitest.config.ts`/`tests/`.
      NOTE for future iterations — install/config gotchas hit on this sandbox
      (Node 20.15, npm 10.7):
  - `npm install` did not fetch the platform-specific
    `@rolldown/binding-linux-x64-gnu` optional dep that `vite@8`'s hard
    `rolldown` dependency needs (npm optional-deps bug). Fixed by
    `npm install --no-save @rolldown/binding-linux-x64-gnu@1.1.5`. If a fresh
    clone fails at `vitest run` with "Cannot find native binding", that's the
    cause.
  - Vite/Vitest config loading via CJS `require()` broke on an ESM-only
    transitive dep (`std-env`) because the package has no `"type": "module"`.
    Fixed by naming the config `vitest.config.mts` (forces ESM regardless of
    package `type`) rather than adding `"type": "module"` to `package.json`
    (which would be a bigger, riskier change for Next's own build).
  - `jsdom@29.x` pulls `html-encoding-sniffer@6`, which is ESM-only
    (`@exodus/bytes`) and breaks under vitest's CJS worker `require()`.
    Pinned `jsdom` to `26.1.0`, the last line whose `html-encoding-sniffer`
    dependency (`^4.0.0`) is CJS. Revisit the pin when vitest's default test
    environment loader handles ESM deps, or when jsdom's own require path
    is fixed upstream.

- [x] **0.3 Lint, format, and the `verify` script**
      Deps: 0.2.
      ESLint (next/core-web-vitals + @typescript-eslint, already scaffolded in
      0.1/0.2) now also runs `eslint-config-prettier` last in the flat config
      to disable stylistic rules that would fight Prettier. Added Prettier
      (`.prettierrc.json`, `.prettierignore`), `format`/`format:check`
      scripts, a `typecheck` script (`tsc --noEmit`), and
      `"verify": "npm run lint && npm run typecheck && npm run test:coverage && npm run build"`.
      Ran `prettier --write .` once to normalize all pre-existing files
      (formatting-only diff, verified via `git diff` — no logic changes).
      AC met: deliberately introduced a type error, confirmed `npm run verify`
      exits 1 and fails at the `typecheck` step; removed the scratch file and
      confirmed `npm run verify` exits 0 through lint, typecheck,
      test:coverage (100% on the one source file), and build.
      NOTE: `verify` does not run `format:check` — the AC's script string is
      exact from the plan. `format:check` exists as a standalone script if a
      future CI step wants a formatting gate; it isn't wired in by this task.

- [x] **0.4 Typed environment config**
      Deps: 0.1.
      `src/lib/env.ts` — two zod schemas: `serverSchema` (DB, Stripe secret,
      ALLOW_LIVE, admin bootstrap, R2, Resend, Sentry — only DATABASE_URL,
      STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET required, rest `.optional()`
      since nothing consumes them yet) and `clientSchema` (`NEXT_PUBLIC_*`,
      both required). Parsed once at module load via a `parseOrThrow` helper
      that throws one `Error` listing every invalid/missing field path — e.g.
      `- DATABASE_URL: Invalid input: expected string, received undefined`.
      Exports `env` (server-only, full set) and `clientEnv` (public subset).
      `clientEnv` reads each var through a literal `process.env.NEXT_PUBLIC_X`
      expression, not a `process.env` spread — Next's compiler only inlines
      literal member-expression reads into the client bundle, so a dynamic
      lookup would silently be `undefined` in the browser.
      Root layout (`src/app/layout.tsx`) imports `env` and uses
      `NEXT_PUBLIC_SITE_URL` for `metadata.metadataBase`, which forces the
      parse to run during `next build`'s page-data collection — this is what
      makes the AC's build failure happen, not an explicit boot script.
      `.env.example` already had the right names/comments from 0.1; unchanged.
      Added `.env.local` (gitignored, dummy `sk_test_`/`whsec_` style values
      matching `.github/workflows/ci.yml`'s dummy env block) so local
      `npm run dev`/`build` work without real credentials.
      AC met: emptied `.env.local` of `DATABASE_URL`/`STRIPE_SECRET_KEY`/
      `STRIPE_WEBHOOK_SECRET`, ran `npm run build`, confirmed it fails with
      `Invalid environment variables:` naming all three; restored the file,
      confirmed build passes again. `src/lib/env.test.ts` (5 cases: full
      success, missing required server var throws naming it, missing required
      public var throws naming it, `ALLOW_LIVE` string→boolean coercion,
      `clientEnv` excludes server secrets) — 100% coverage on `env.ts`.
      NOTE for later phases: when Stripe/R2/Resend/Sentry modules are actually
      built (3.1, 4.5, 3.7, 5.3), promote their now-`.optional()` vars to
      required in `serverSchema` at that point, not before — an unused
      required var would fail `npm run build` for no functional reason.

- [x] **0.5 CI pipeline**
      Deps: 0.3.
      `.github/workflows/ci.yml` already existed (from an earlier iteration,
      commit 801d4e6) but was broken: it ran `npm run db:migrate` (no such
      script — Postgres/Drizzle isn't wired up until 1.1) and had a second
      `e2e` job running `npm run test:e2e` (no such script — Playwright isn't
      installed until 5.5). Either would fail on a fresh clone of `main` right
      now, so the AC ("green on main") wasn't actually met despite the file
      existing and the checklist being unticked.
      Fix: removed the `postgres` service, the `Migrate test database` step,
      and the whole `e2e` job, leaving `verify` (checkout, setup-node@20,
      `npm ci`, lint, typecheck, test:coverage, coverage-summary → step
      summary, upload coverage artifact, build) — i.e. exactly `npm run
    verify` plus the artifact/summary steps, matching what the repo can
      actually run today.
      Added `tests/unit/ci-config.test.ts`: a regression test that parses
      `.github/workflows/ci.yml` for every `npm run <script>` reference and
      asserts each exists in `package.json`'s `scripts`. This is what caught
      the bug (failed listing `db:migrate`/`test:e2e` as missing before the
      fix) and will catch it again if a future phase's CI step is added
      before its npm script lands.
      AC met: confirmed red by renaming the lint step's script to `lintxyz`
      (test failed, listing exactly that name as missing) and green again
      after reverting. `npm run verify` passes locally (lint, typecheck,
      test:coverage — 3 files/7 tests, 100%, build).
      NOTE for 1.1 and 5.5: when the DB schema and Playwright suite land,
      re-add the `postgres` service + `db:migrate` step to the `verify` job
      (or a new job) and a `test:e2e` job respectively — the guard test above
      will pass automatically once the corresponding npm script exists.

- [x] **0.6 Pre-commit hook**
      Deps: 0.3. Husky (`9.1.7`) + lint-staged (`16.4.0` — v17 requires Node
      `>=22.22.1`, incompatible with this sandbox's Node 20.15; v16 needs
      `>=20.17`, close enough that it only warns, doesn't fail). `npx husky
    init` created `.husky/pre-commit` and added `"prepare": "husky"` to
      `package.json` (runs on `npm install`, wires the git hooks path).
      Replaced the scaffolded default (`npm test`, which the task explicitly
      says NOT to run — full suite is too slow for a hook) with `npx
    lint-staged`. Added a `"lint-staged"` block to `package.json`: `*.{js,
    jsx,ts,tsx,mjs,cjs}` gets `eslint --fix` then `prettier --write`;
      `*.{json,md,css}` gets `prettier --write` only (ESLint's flat config
      doesn't lint those).
      `tests/unit/pre-commit-hook.test.ts` (4 cases, following the
      `ci-config.test.ts` pattern of asserting against real repo files
      rather than mocking): hook file contains `lint-staged` not the full
      test command, hook file is executable (checks the POSIX exec bits via
      `statSync(...).mode & 0o111`), `package.json` has a `lint-staged`
      config whose commands include both `eslint` and `prettier`, and
      `prepare` script is exactly `"husky"`.
      AC met — verified live, not just via the unit test: staged a scratch
      file with `const bad = (x:any) => {...}` and ran `git commit`; husky's
      pre-commit hook ran `lint-staged`, `eslint --fix` failed on
      `@typescript-eslint/no-explicit-any`, lint-staged reverted the stash
      and aborted, and `git commit` exited 1 — nothing was committed. Removed
      the scratch file afterward.
      NOTE: lint-staged's revert-on-failure flow uses `git stash` internally
      as a backup — if a hook run is killed mid-flight (e.g. `kill -9`) a
      stray stash entry can be left behind. Not hit in this iteration, just
      worth knowing if `git stash list` ever shows an unexpected entry after
      a bad commit attempt.

---

## Phase 1 — Data layer

- [ ] **1.1 Database schema**
      Deps: 0.4. See `specs/02-data-model.md` — implement it exactly.
      Tables: `products`, `product_variants`, `product_images`, `categories`,
      `product_categories`, `inventory_movements`, `orders`, `order_items`,
      `customers`, `addresses`, `admin_users`, `sessions`, `audit_log`,
      `discount_codes`, `webhook_events`.
      AC: `npm run db:migrate` applies cleanly against a fresh Postgres; a rollback
      and re-apply also works.

- [ ] **1.2 Local dev database**
      Deps: 1.1. `docker-compose.yml` with Postgres 16 + a `db:reset` script.
      AC: `npm run db:reset` gives a fresh migrated empty database in <10s.

- [ ] **1.3 Repository layer**
      Deps: 1.1. `src/lib/repos/*` — the only modules that import Drizzle.
      Typed CRUD for products, variants, orders, inventory.
      AC: every repo function has an integration test against the dev database.
      Repos ≥85% covered.

- [ ] **1.4 Seed + CSV catalog importer**
      Deps: 1.3. Importer reads the Shopify product CSV export into the schema —
      handles variants, images, tags→categories, and per-variant SKU/price.
      Dry-run mode prints a diff and changes nothing.
      AC: importing the real export produces the correct product/variant counts;
      malformed rows are reported, not silently dropped; unit tests cover missing
      columns, duplicate SKUs, and non-numeric prices.
      🚦 HUMAN GATE — confirm the parsed catalog before the first non-dry-run.

---

## Phase 2 — Storefront

- [ ] **2.1 Design tokens + layout shell**
      Deps: 0.1. Brand colors, type scale, spacing in Tailwind config. Header with
      nav + cart indicator, footer with policy links. Mobile-first.
      AC: layout renders at 360px, 768px, 1440px with no horizontal scroll;
      axe reports zero violations on the shell.

- [ ] **2.2 All-products page**
      Deps: 1.3, 2.1. Server-rendered grid.
      AC: renders all published products with image, name, price-from, and
      out-of-stock state. Unpublished products are absent from the HTML, not
      hidden with CSS.

- [ ] **2.3 Sort and filter**
      Deps: 2.2. See `specs/03-storefront.md`.
      Filters: category, scent, price range, in-stock-only.
      Sorts: newest, price asc/desc, name A–Z.
      **State lives in the URL query string** and filtering happens in SQL, not in
      the browser. Filter state must survive a page reload and be shareable.
      AC: `?category=candles&sort=price_asc&inStock=true` returns exactly the right
      set in the right order; combined filters AND together; unknown params are
      ignored rather than erroring; empty result shows a "no matches, clear filters"
      state. Tests cover each filter alone, two combined, and the empty case.

- [ ] **2.4 Pagination**
      Deps: 2.3. Cursor or offset, consistent with filters.
      AC: page 2 preserves all active filters; no duplicate or dropped items across
      page boundaries when sorting by a non-unique key (tie-break on id).

- [ ] **2.5 Product detail page**
      Deps: 1.3, 2.1. Gallery, variant selector, price that updates with variant,
      description, ingredients, weight/burn time, care and safety info, add-to-cart.
      AC: selecting a variant updates price and stock without a full reload;
      page works with JS disabled for the read-only content; 404 for unknown slug.

- [ ] **2.6 SEO + structured data**
      Deps: 2.5. Per-page metadata, OG images, `Product` + `Offer` JSON-LD,
      `sitemap.xml`, `robots.txt`, canonical URLs.
      AC: JSON-LD validates; sitemap lists every published product; filtered
      listing URLs are `noindex` to avoid crawl bloat.

- [ ] **2.7 Cart**
      Deps: 2.5. Server-side cart keyed by an httpOnly cookie. Add, update qty,
      remove, persist across sessions. Line totals recomputed server-side on read.
      AC: a cart containing a product whose price later changes reflects the _new_
      price at checkout; removing the last item empties cleanly; quantity is clamped
      to available stock. Cart service ≥90% covered.

- [ ] **2.8 Content pages**
      Deps: 2.1. About, contact, FAQ, shipping, returns, privacy, terms.
      AC: all footer links resolve; no lorem ipsum ships.
      🚦 HUMAN GATE — policy copy must be written/approved by the owner.

---

## Phase 3 — Payments

- [ ] **3.1 Stripe client + test-mode wiring**
      Deps: 0.4. Singleton client, pinned API version, test keys only.
      AC: a unit test asserts the client refuses to initialize with a `sk_live_*` key
      unless `ALLOW_LIVE=true`.

- [ ] **3.2 Catalog → Stripe sync**
      Deps: 1.3, 3.1. See `specs/05-payments.md`. Database is the source of truth;
      variants map to Stripe Prices. Sync is idempotent and stores Stripe ids back.
      AC: running sync twice creates no duplicates; a price change creates a new
      Price and archives the old one rather than mutating it.

- [ ] **3.3 Checkout session**
      Deps: 2.7, 3.2. Build the session from the server-side cart. Collect shipping
      address, apply shipping rates, enable Stripe Tax.
      AC: a tampered client payload (altered price or quantity) produces a session
      with the correct server-derived amounts. This test is mandatory.

- [ ] **3.4 Webhook endpoint**
      Deps: 3.3. Verify signature. Handle `checkout.session.completed`,
      `payment_intent.payment_failed`, `charge.refunded`,
      `charge.dispute.created`.
      **Idempotent**: persist `event.id` in `webhook_events` and no-op on replay.
      AC: replaying the same event twice creates exactly one order and decrements
      inventory once; an invalid signature returns 400 and writes nothing; an
      unhandled event type returns 200 and is logged. Webhook module ≥90% covered.

- [ ] **3.5 Order creation + inventory decrement**
      Deps: 3.4. Single database transaction: create order, create order items,
      write inventory movements, empty the cart.
      AC: a failure partway through rolls back entirely — no orphaned order rows,
      no phantom inventory movements. Test the failure path explicitly.

- [ ] **3.6 Oversell guard**
      Deps: 3.5. Re-check stock at session creation and again at webhook time.
      AC: two concurrent checkouts for the last unit result in one fulfilled order
      and one that is caught and refunded/flagged. Concurrency test required.

- [ ] **3.7 Confirmation page + transactional email**
      Deps: 3.5. Success page keyed by session id (not order id — don't leak an
      enumerable identifier). Receipt email via Resend.
      AC: refreshing the success page does not duplicate anything; email renders in
      plain text as well as HTML; email sending failure does not fail the order.

- [ ] **3.8 Discount codes**
      Deps: 3.3. Percentage and fixed-amount, expiry, usage cap, min-spend.
      AC: expired/exhausted codes are rejected server-side with a clear message;
      a code cannot be applied twice; validation is server-side only.

---

## Phase 4 — Admin portal

- [ ] **4.1 Admin authentication**
      Deps: 1.1. See `specs/04-admin.md`. Email + argon2id password, httpOnly
      session cookie, `SameSite=Lax`, rotation on login, server-side revocation.
      Rate-limit login (5 attempts / 15 min / IP+email). CSRF tokens on all mutations.
      AC: wrong password, locked-out, expired-session, and CSRF-missing paths are
      each tested. Timing-safe comparison. Passwords never logged. Auth ≥90% covered.

- [ ] **4.2 Route protection**
      Deps: 4.1. Middleware guarding `/admin/**` and admin API routes.
      AC: an unauthenticated request to every admin route redirects/401s — test
      enumerates the routes so a newly added unguarded route fails the suite.

- [ ] **4.3 Product CRUD**
      Deps: 4.2, 1.3. Create, edit, publish/unpublish, soft-delete. Slug generation
      with collision handling. Zod validation shared client and server.
      AC: soft-deleted products vanish from the storefront but remain linked from
      historical orders; validation errors render per-field.

- [ ] **4.4 Variant + inventory management**
      Deps: 4.3. Per-variant SKU, price, stock. Manual stock adjustment writes an
      `inventory_movements` row with a reason.
      AC: stock is never edited directly — it is always derived from movements, so
      the ledger and the displayed count cannot diverge.

- [ ] **4.5 Image upload**
      Deps: 4.3. Cloudflare R2 via presigned URLs. Validate MIME by magic bytes not
      extension, cap size, strip EXIF, generate responsive sizes, set alt text.
      AC: a `.png`-named file that is actually a script is rejected; alt text is
      required before publish.

- [ ] **4.6 Orders dashboard**
      Deps: 3.5, 4.2. List with status filter and search; detail view with items,
      totals, addresses, Stripe payment link.
      AC: totals shown always equal the sum of stored line items — assert this
      rather than recomputing in the view.

- [ ] **4.7 Fulfillment**
      Deps: 4.6. Mark packed/shipped, tracking number + carrier, shipping-notice
      email to the customer.
      AC: status transitions are validated (cannot ship a refunded order); each
      transition writes to `audit_log`.

- [ ] **4.8 Refunds**
      Deps: 4.6, 3.4. Full and partial refunds through Stripe; restock optional.
      AC: refund is initiated via Stripe and the local order status is updated by
      the resulting webhook, not optimistically in the request handler.

- [ ] **4.9 Audit log view**
      Deps: 4.7. Who did what, when, to which record.
      AC: every admin mutation appears; the log is append-only with no UI to edit it.

---

## Phase 5 — Hardening

- [ ] **5.1 Security headers + rate limiting**
      Deps: 4.2. CSP (nonce-based, Stripe domains allowlisted), HSTS,
      `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
      Rate-limit cart, checkout, login, and contact endpoints.
      AC: CSP has no `unsafe-inline` for scripts; Stripe Checkout redirect still works.

- [ ] **5.2 Accessibility pass**
      Deps: 2.5, 2.7. axe assertions on every page-level test. Keyboard-only path
      from listing → product → cart → checkout. Focus management on modals.
      AC: zero serious/critical axe violations; the keyboard path is an E2E test.

- [ ] **5.3 Error handling + monitoring**
      Deps: 0.5. Error boundaries, `not-found.tsx`, `error.tsx`, Sentry with PII
      scrubbing.
      AC: a thrown server error shows a friendly page and reports once; no card
      data, email, or address reaches Sentry — test the scrubber.

- [ ] **5.4 Performance budget**
      Deps: 2.5. Lighthouse CI in the pipeline. Images via `next/image`, correct
      `sizes`, LCP image preloaded.
      AC: mobile Lighthouse ≥90 performance / 100 accessibility on the listing and
      product pages; CI fails if it regresses.

- [ ] **5.5 E2E suite**
      Deps: 3.7, 4.3. Playwright: browse → filter → product → cart → checkout with
      Stripe test card `4242…` → webhook → order visible in admin. Plus a declined
      card (`4000000000000002`) and a 3DS card (`4000002500003155`).
      AC: the suite runs green in CI against test-mode Stripe with the CLI forwarding
      webhooks.

- [ ] **5.6 Backups + restore drill**
      Deps: 1.1. Automated daily Postgres backup; documented restore.
      AC: a restore into a scratch database is actually performed and the steps that
      worked are written into `specs/08-deploy-ops.md`.

---

## Phase 6 — Launch

- [ ] **6.1 Staging deploy**
      Deps: 5.5. Cloudflare Workers + Neon, still Stripe test mode.
      AC: full E2E passes against the deployed staging URL.

- [ ] **6.2 Domain, DNS, TLS**
      Deps: 6.1. 🚦 HUMAN GATE — owner controls the registrar.
      AC: apex and `www` resolve, TLS valid, one canonical redirect direction.

- [ ] **6.3 Production environment**
      Deps: 6.2. Secrets in the platform store; production database separate from
      staging with its own credentials.
      AC: no secret appears in the repo or in build logs.

- [ ] **6.4 Stripe live mode**
      Deps: 6.3. 🚦 HUMAN GATE — the owner performs this step.
      Live keys, live webhook endpoint + signing secret, business details, payout
      account, tax registrations.
      AC: one real low-value order is placed, fulfilled, and refunded end to end.

- [ ] **6.5 Analytics**
      Deps: 6.3. Plausible or Umami — cookieless, no consent banner needed.
      AC: pageviews and checkout completions recorded; no third-party ad trackers.

- [ ] **6.6 Shopify migration**
      Deps: 6.4. Final catalog import, 301 redirects from old Shopify URLs, export
      historical orders for records.
      AC: every old product URL that had traffic resolves to its new equivalent.

- [ ] **6.7 Owner handover**
      Deps: 6.4. `docs/RUNBOOK.md`: add a product, process an order, issue a refund,
      what to do if the site is down, who to call.
      AC: the owner completes each task unaided from the doc.

---

## Blocked — needs human

_(agent appends here; do not guess around a blocker)_

- Brand assets: logo, color palette, product photography — needed for 2.1.
- Policy copy: shipping, returns, privacy, terms — needed for 2.8.
- Confirmation on cosmetics labeling: MoCRA requires an ingredient list and a
  responsible-person contact for body butter; candles need ASTM F2417 fire-safety
  warnings. Product data model assumes these fields exist. Needed for 1.1.

## Done

_(agent appends completed-phase summaries here)_
