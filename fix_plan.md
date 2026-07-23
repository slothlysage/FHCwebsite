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

- [x] **1.1 Database schema**
      Deps: 0.4. See `specs/02-data-model.md` — implement it exactly.
      `src/lib/db/schema.ts` — all 15 tables from the spec (no separate
      `customers` table; `orders.email` plus `addresses` covers it, matching
      the spec body which never actually defines a `customers` table despite
      the fix_plan bullet naming one — flagged, not guessed around, see the
      NOTE below) plus the `variant_stock` view (`SELECT variant_id,
coalesce(sum(delta),0)::int AS stock FROM inventory_movements GROUP BY
variant_id` — a plain, not materialized, view so it's always fresh with
      no trigger to keep in sync). `src/lib/db/client.ts` — drizzle
      singleton over `pg.Pool`, using `env.DATABASE_URL`.
      Installed `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`. `tsx` was
      briefly added for a TS migration runner, then removed — see below.
      AC met: spun up a throwaway `postgres:16-alpine` docker container,
      confirmed `npm run db:migrate` applies cleanly to a fresh database (all
      15 tables + the view), re-running it on an already-migrated database is
      a no-op (drizzle's own `__drizzle_migrations` tracking table), and a
      full drop + recreate + re-apply cycle (the closest meaningful thing to
      "rollback" for a forward-only migration tool — drizzle-kit does not
      generate down migrations) also applies cleanly from empty.
      `src/lib/db/schema.test.ts` (4 integration tests against the real,
      migrated database): unique slug constraint, FK rejects an orphaned
      variant, `variant_stock` sums movements correctly, and a variant with
      zero movements has no row in the view (confirmed each test fails with
      `relation "products" does not exist` against an unmigrated DB, then
      passes after `db:migrate` — the red/green cycle AGENT.md requires).
      `src/lib/db/schema-indexes.test.ts` (14 more tests, via drizzle-orm's
      `getTableConfig`): asserts every explicit index from the spec's
      "Indexes to create explicitly" list exists by name, the
      `product_categories` composite PK, the case-insensitive unique index on
      `discount_codes.code`, and every `.references(() => otherTable.col)`
      FK actually points at the right table. This wasn't optional padding —
      drizzle's `extraConfig` callbacks (indexes/PKs/unique constraints) and
      FK target thunks are stored but never invoked by ordinary query
      building, only by `drizzle-kit`/`getTableConfig` — so without this file
      those lines were genuinely dead code from vitest's perspective and
      coverage sat at ~65-75%, not because anything was untested but because
      nothing ever called the lazy builders. Calling `getTableConfig` in a
      test is a legitimate way to both cover and assert-correct that
      lazily-evaluated config.
      CI: re-added the `postgres:16-alpine` service (removed in 0.5 because
      nothing needed it yet) and a `Migrate test database` step
      (`npm run db:migrate`) before `Test with coverage`, exactly as 0.5's
      NOTE anticipated.
      NOTE: `scripts/db-migrate.mjs` (not `src/lib/db/migrate.ts`) is the
      `db:migrate` CLI entry point — deliberately outside `src/lib`, alongside
      the existing `scripts/coverage-summary.mjs`, so it's outside vitest's
      `coverage.include: ["src/**"]` the same structural way `*.config.*`
      files already are. The alternative (a `src/lib/db/migrate.ts` with a
      testable-function/CLI-guard split) was tried first, but the CLI-guard
      branch itself would never be exercised under vitest, and mocking `pg` + drizzle's `migrate()` to cover a 10-line wrapper is exactly the "test
      that asserts nothing" AGENT.md warns against — the real proof that
      migrations work is `schema.test.ts` running against a database that
      script actually migrated. This is also why `tsx` (installed to run a
      `.ts` migration script directly) was removed again — `.mjs` needs no
      transpilation.
      NOTE for 1.2 (local dev database): the `docker-compose.yml` +
      `db:reset` task still needs doing — this iteration proved the
      migrate/rollback/reapply cycle by hand against an ad hoc
      `docker run postgres:16-alpine` container (removed after), not a
      committed compose file. Local dev and any future manual verification
      needs that container brought up by hand until 1.2 lands.
      NOTE for 1.3+ (repos): `schema.test.ts`'s afterEach cleanup pattern
      (delete children before parents, by collected id, rather than
      transaction-rollback) is there because drizzle's `db.transaction`
      requires catching a rollback-marker error thrown by `tx.rollback()`,
      which added noise for little benefit at this scale — reconsider if
      1.3's repo integration tests get numerous enough that manual cleanup
      becomes the bigger noise source.
      NOTE — flagging, not guessing: the fix_plan bullet above named a
      `customers` table, but `specs/02-data-model.md` never defines one —
      only `orders` (with a plain `email` column) and a standalone
      `addresses` table. Implemented the spec as written. If a real
      `customers` table (e.g. for repeat-customer history or accounts) is
      wanted, that needs a spec update first, not a schema guess.

- [x] **1.2 Local dev database**
      Deps: 1.1. `docker-compose.yml` — single `postgres:16-alpine` service,
      `POSTGRES_USER=user`/`POSTGRES_PASSWORD=pass`/`POSTGRES_DB=fhc` to match
      `.env.example`'s `DATABASE_URL`, port `5432:5432`, named volume
      (`fhc_postgres_data`) so data survives `docker compose down` (not `-v`),
      healthcheck via `pg_isready`.
      `scripts/db-reset.mjs` — new CLI script alongside `db-migrate.mjs`
      (same rationale: outside `src/lib`, outside the coverage gate, no logic
      beyond gluing `pg`+drizzle calls together). Connects to the `postgres`
      admin database (derived from `DATABASE_URL` by swapping the path),
      terminates other backends on the target db, `DROP DATABASE IF EXISTS` +
      `CREATE DATABASE`, then runs the same `migrate()` call as
      `db-migrate.mjs`. Added `"db:reset": "node scripts/db-reset.mjs"`.
      `tests/unit/docker-compose.test.ts` (2 tests, `ci-config.test.ts`
      pattern — regex assertions against the real files, not a YAML parser
      dependency): `docker-compose.yml` exists and its image/port/env vars
      match `.env.example`'s `DATABASE_URL`; `package.json`'s `db:reset`
      script points at a script file that actually exists. Confirmed both
      fail for the right reason (file/script missing) before implementing.
      AC met, verified live: `docker compose up -d postgres`, waited for
      the healthcheck, ran `npm run db:reset` twice in a row — ~1.1s each
      time (well under 10s), first run produced all 15 tables + view
      empty, second run (against an already-migrated db) was equally fast
      and left it empty again. Also ran the full `npm run verify` gate
      against the running container: 33 tests, 100% coverage, build green.
      `docker compose down` afterward to leave no container running between
      iterations; the named volume persists (by design — `down` without
      `-v`) so the next `docker compose up` starts from where this one left
      off rather than a surprise empty volume.
      NOTE: this sandbox has a working `docker`/`docker compose` CLI
      (v29.6.2) — 1.1's NOTE about proving migrations "by hand" with an ad
      hoc container is now superseded; use `docker compose up -d postgres`
      going forward instead of a bare `docker run`.
      NOTE: CI's `postgres` service (added in 1.1, `.github/workflows/ci.yml`)
      is independent of this compose file — it uses different credentials
      (`postgres`/`postgres`/`fhc_test`) and is provisioned directly by
      GitHub Actions' `services:` block, not docker-compose. No change needed
      there; `docker-compose.yml` is local-dev-only per `specs/08-deploy-ops.md`.

- [x] **1.3 Repository layer**
      Deps: 1.1. `src/lib/repos/*` — the only modules that import Drizzle.
      Typed CRUD for products, variants, orders, inventory.
      AC: every repo function has an integration test against the dev database.
      Repos ≥85% covered.
      Split into sub-tasks below (one repo module is a full task on its own —
      each needs its own integration-test file against the real dev database).
      This umbrella item is ticked `[x]` only once all four below are `[x]`.

  - [x] **1.3a Products repo**
        Deps: 1.1. `src/lib/repos/products.ts` — createProduct, getProductById,
        getProductBySlug, listProducts (optional `{status?, includeDeleted?}`,
        excludes soft-deleted by default), updateProduct, softDeleteProduct
        (sets `deletedAt` + `updatedAt`, does not hard-delete).
        `src/lib/repos/products.test.ts` — 9 integration tests against the
        real dev database (create default-draft, getById found/not-found,
        getBySlug, list filtered by status excluding soft-deleted, list with
        no filter across statuses, list with `includeDeleted: true`, update,
        soft-delete keeps the row retrievable by id with `deletedAt` set).
        AC met: 100% statement/branch/function/line coverage on
        `products.ts` alone; full `npm run verify` green (42 tests, 100%
        global coverage, build passes).
        NOTE — env vars for local test runs: neither `vitest.config.mts` nor
        any npm script loads `.env.local` into `process.env` (confirmed by
        running `schema.test.ts` cold — it fails the same env-parse error
        this task's test did until `.env.local` is exported by hand). CI works
        because `ci.yml` sets the vars directly in the `env:` block. Local
        runs against the dev database need
        `set -a; source .env.local; set +a` (or equivalent) before
        `vitest`/`npm run test:coverage`. Future repo-layer iterations (1.3b–d)
        hit this same wall — this note is here so they don't re-discover it.
        NOTE for 1.3b: `softDeleteProduct`/`updateProduct` both stamp
        `updatedAt: new Date()` explicitly rather than relying on the
        column's `defaultNow()` (which only fires on insert, not update) —
        the same pattern will be needed for any other table with an
        `updated_at` column.

  - [x] **1.3b Variants repo**
        Deps: 1.3a. `src/lib/repos/variants.ts` — createVariant, getVariantById,
        listVariantsByProductId (all variants, active or not — used by admin),
        listActiveVariantsByProductId (storefront-facing, filters
        `isActive = true` in SQL), updateVariant, deactivateVariant
        (`isActive = false`, no hard delete — variants are referenced by
        `order_items`). Mirrors `products.ts`'s shape exactly (typed
        `$inferSelect`/`$inferInsert`, `returning()` after
        insert/update, `[x]!` non-null assertion on the single-row insert
        result).
        `src/lib/repos/variants.test.ts` — 7 integration tests against the
        real dev database (create, getById found/not-found, list all for a
        product, active-only list excludes a deactivated variant, update,
        deactivate keeps the row retrievable with `isActive: false`).
        AC met: 100% statement/branch/function/line coverage on the repo
        module alone; full `npm run verify` green (9 files, 49 tests, 100%
        global coverage, build passes). Confirmed the test file fails for the
        right reason (import resolution error, module doesn't exist) before
        writing `variants.ts`.
        NOTE: unlike `products`, `product_variants` has no `updated_at`
        column in the schema (see `specs/02-data-model.md`'s field list), so
        `updateVariant`/`deactivateVariant` do NOT stamp a timestamp the way
        1.3a's NOTE for products does — don't copy that pattern here by
        reflex for 1.3c/1.3d without checking each table's actual columns
        first.

  - [x] **1.3c Inventory repo**
        Deps: 1.3b. `src/lib/repos/inventory.ts` — recordMovement (insert into
        `inventory_movements`), getStockForVariant (reads `variant_stock`
        view, returns 0 for a variant with no rows per `specs/02-data-model.md`),
        getStockForVariants (batch, for a listing page — pre-seeds every
        requested id with 0 in the returned `Map` before merging in the
        view's rows, so callers never have to special-case a missing key
        for "no movements yet" the way they would with the raw view).
        `src/lib/repos/inventory.test.ts` — 5 integration tests against the
        real dev database (record a movement, sum of positive+negative
        deltas via `getStockForVariant`, zero-movements variant reads as 0,
        batch lookup across three variants including one with zero
        movements, empty-array batch returns an empty `Map`). Confirmed red
        first (import resolution error, module doesn't exist) before writing
        `inventory.ts`.
        AC met: 100% statement/branch/function/line coverage on the repo
        module alone; full `npm run verify` green (10 files, 54 tests, 100%
        global coverage, build passes).
        NOTE: `getStockForVariants` guards the empty-array case explicitly —
        drizzle's `inArray(col, [])` compiles to `IN ()`, which Postgres
        rejects as invalid syntax. Any future batch-lookup repo function
        built on `inArray` needs the same empty-input guard.

  - [x] **1.3d Orders repo**
        Deps: 1.3b. `src/lib/repos/orders.ts` — createOrder(order, items)
        (order + order_items in one `db.transaction`), getOrderById,
        getOrderByStripeSessionId, listOrdersByStatus, updateOrder (patch —
        status transitions, `paidAt`/`fulfilledAt` are just fields on the
        patch, no separate transition function).
        `src/lib/repos/orders.test.ts` — 8 integration tests against the real
        dev database: create-with-items (asserts the returned order and that
        `order_items` rows exist with the right `orderId`), the atomicity
        test (an item with a `variantId` that doesn't exist in
        `product_variants` violates the FK inside the transaction — asserts
        `createOrder(...)` rejects, then that neither the order — looked up
        by its unique `stripeSessionId` — nor the item — looked up by a
        unique `skuSnapshot` marker, since the failed insert never returns an
        id to key off — persisted), getById found/not-found,
        getByStripeSessionId found/not-found, listByStatus (filters paid vs.
        pending), update (status + both timestamp fields in two successive
        patches). Confirmed red first by moving `orders.ts` aside — the test
        failed on import resolution, not a runtime error — then restored it.
        AC met: 100% statement/branch/function/line coverage on the repo
        module; full `npm run verify` green (11 files, 62 tests, 100% global
        coverage, build passes).
        NOTE: `orderItems.variantId` is nullable (a variant may be deleted
        later — see the spec's snapshot-column rationale), so Postgres only
        enforces the FK when a value is actually provided. The atomicity test
        exploits exactly this: it must pass a non-null-but-nonexistent uuid
        to get a real FK violation, since passing `null` would insert
        successfully and prove nothing about rollback.
        NOTE: no `getOrderItemsByOrderId` (or any order-items reader) exists
        yet — out of scope per the fix_plan bullet, which lists only the five
        order-level functions above. 3.5 (order creation + inventory
        decrement) or 4.6 (orders dashboard) will need one; add it there, not
        here, as a repo-import fix if items are needed before then instead of
        guessing at a shape now.

- [x] **1.4 Seed + CSV catalog importer**
      Deps: 1.3. Importer reads the Shopify product CSV export into the schema —
      handles variants, images, tags→categories, and per-variant SKU/price.
      Dry-run mode prints a diff and changes nothing.
      AC: importing the real export produces the correct product/variant counts;
      malformed rows are reported, not silently dropped; unit tests cover missing
      columns, duplicate SKUs, and non-numeric prices.
      🚦 HUMAN GATE — confirm the parsed catalog before the first non-dry-run.
      Split into sub-tasks below (parse/validate is pure and independently
      testable from the DB-writing/diff side, same rationale as 1.3's split).
      This umbrella item is ticked `[x]` only once both below are `[x]`.

  - [x] **1.4a CSV parser + validation**
        Deps: 1.3. `src/lib/services/catalog-importer.ts` — pure, DB-free
        `parseShopifyCsv(csvText)` using the `csv-parse` package (added as a
        dependency; RFC 4180 quoting/embedded-comma/newline handling is
        exactly what a hand-rolled split(",") gets wrong, and `Body (HTML)`
        routinely contains commas). Rows are grouped by `Handle` via a
        `Map` (insertion order = output order); the first row seen for a
        handle carries product-level fields (`Title`, `Body (HTML)`, `Tags`
        → `categories`), later rows with the same handle add variants and/or
        images and leave product-level columns blank — matching Shopify's
        real export shape.
        Required columns: `Handle`, `Title`, `Variant SKU`, `Variant Price`,
        `Variant Grams` (the last because `product_variants.weight_grams` is
        `NOT NULL` with no default per `specs/02-data-model.md`). Missing
        required columns are a whole-file error (`row: 0, handle: null`,
        one entry per missing column) and abort parsing — a header problem
        invalidates every row, so partial output would be misleading.
        Row-level problems (blank `Handle`, blank `Title` on a new handle,
        duplicate SKU anywhere in the file, non-numeric `Variant
Price`/`Variant Compare At Price`/`Variant Grams`) are collected into
        an `errors: ImportRowError[]` array with a 1-based data-row number
        and the offending handle; the row/variant is skipped, not thrown,
        and parsing continues — this is what "malformed rows are reported,
        not silently dropped" means in practice; 1.4b decides whether any
        errors should block a real `--apply` run.
        A row with a blank `Variant SKU` but a non-empty `Handle` is treated
        as an image-only continuation row (real Shopify exports use these to
        attach extra product images without adding a variant), not an error.
        `src/lib/services/catalog-importer.test.ts` — 12 unit tests: a
        well-formed multi-variant/multi-image product, every missing-required-
        column case at once, duplicate SKU (second occurrence dropped, first
        kept), non-numeric price/compare-at-price/weight (each skips only
        that variant), blank Handle, blank Title on a new handle, an
        image-only continuation row, a minimal CSV containing only the five
        required columns (proves optional-column-absent files still parse),
        a CSV missing only `Image Alt Text` (defaults to `""`), and the
        empty-catalog case. Confirmed red first (import resolution error,
        module didn't exist) before writing `catalog-importer.ts`.
        AC met: 100% statement/branch/function/line coverage on the module
        (exceeds the 90% `src/lib/services/**` floor); full `npm run verify`
        green (12 files, 74 tests, 100% global coverage, build passes).
        NOTE for 1.4b: `raw[column]!.trim()` (non-null assertion) is used for
        the five required columns, not `?.trim() ?? ""` — after the header
        check confirms they exist, and because `csv-parse` rejects any data
        row whose column count doesn't match the header (confirmed: a short
        row throws `Invalid Record Length`, it doesn't silently pad with
        `undefined`), those keys are runtime-guaranteed strings despite
        `noUncheckedIndexedAccess` typing bare indexed access as possibly
        `undefined`. The `?.trim() ?? ""` / `|| null` pattern is kept only for
        genuinely optional columns (`Tags`, `Body (HTML)`, `Option1/2/3
Value`, `Variant Compare At Price`, `Image Src`, `Image Position`,
        `Image Alt Text`) that a minimal export may omit entirely.
        NOTE for 1.4b: `parseShopifyCsv` does not enforce "every product has
        at least one variant" (a spec-level expectation, not a DB
        constraint) — a product whose only variant row had a parse error
        comes back with `variants: []`. 1.4b's diff/apply step must decide
        whether to skip such a product or surface it as blocking, not assume
        the array is non-empty.
        NOTE for 1.4b: `slug` is derived as `handle.toLowerCase()` — Shopify
        handles are already URL-safe/hyphenated, so no further slugify step
        was needed. If a future non-Shopify source feeds this parser, that
        assumption would need revisiting.

  - [x] **1.4b Dry-run diff + apply + seed CLI**
        Deps: 1.4a. `src/lib/services/catalog-import.ts` — `runCatalogImport
(parsedProducts, {apply})` diffs parsed products against the
        current catalog (product by slug, each variant by SKU, via the
        products/variants repos) into per-product/per-variant
        `create`/`update`/`unchanged` actions; dry-run (`apply: false`)
        only reads and reports, `apply: true` writes everything inside one
        transaction. `scripts/import-catalog.mts` — CLI wrapper (`npm run
import-catalog -- <file.csv> [--apply]`, dry-run is the default,
        prints row errors then the diff/apply summary).
        `ParsedVariant` (1.4a) gained a `stockQuantity` field — parsed from
        the optional `Variant Inventory Qty` column, defaulting to `0` — so
        `applyCatalogImport` has something to write into the mandatory
        `import`-reason `inventory_movements` row for every newly created
        variant (not re-written on re-apply, so stock doesn't double-count).
        Two new repos, `src/lib/repos/categories.ts` (`getCategoryBySlug`,
        `createCategory`, `linkProductCategory` — `onConflictDoNothing` on
        the composite PK for idempotent re-linking) and
        `src/lib/repos/images.ts` (`replaceProductImages` — delete-then-
        reinsert per product, since `product_images` has no natural upsert
        key). Product images are written with `width`/`height` hardcoded to
        `0` — the CSV carries no real dimensions; that's 4.5's job when it
        actually fetches/processes the image bytes. See
        `specs/02-data-model.md`'s "Implementation notes (1.4b)" for full
        detail, including how the transaction crosses `products.ts`/
        `variants.ts`/`inventory.ts`/`categories.ts`/`images.ts` while
        keeping "only repos import `db`" (AGENT.md) intact via a new
        `DbExecutor` type + optional `executor` param threaded through each
        repo function, and a `src/lib/repos/transaction.ts` helper
        (`withTransaction`) so the service never imports `db` itself.
        `tsx` added as an explicit `devDependency` (previously only
        transitive, via `vite`/`drizzle-kit`) to run the `.mts` CLI, since
        reimplementing the parser/diff logic in plain JS would have
        duplicated already-tested code — the one thing this loop's own
        instructions call out as the most common failure mode.
        AC met (partially — see gate below): `src/lib/services/catalog-
import.test.ts` (5 integration tests against the real dev
        database) proves create/update/unchanged actions, that dry-run
        writes nothing, and — the AC's actual idempotency requirement —
        that applying the same parsed input twice produces no duplicate
        product/variant/category-link/image/inventory-movement rows the
        second time. Also hand-verified end-to-end with the CLI against a
        synthetic CSV (dry-run → apply → re-apply), see
        `specs/02-data-model.md`. `npm run verify` green: 90 tests,
        `catalog-import.ts` at 97.5%/94.87%/100%/97.36%
        (stmts/branches/funcs/lines), comfortably above the 90%
        `src/lib/services/**` floor.
        🚦 HUMAN GATE — CLOSED 2026-07-22. The owner supplied the
        starting catalog as `tests/fixtures/catalog.csv` and confirmed it
        as the data to import. Dry-run inspected first, then
        `npm run import-catalog -- tests/fixtures/catalog.csv --apply`
        run against the local dev database: 5 products / 45 variants /
        45 import-reason inventory movements — exactly matching the CSV
        (9 scents × 5 product types: shampoo-bar, conditioner-bar, soap,
        8oz-candle, 8oz-body-butter). Zero row errors. The dev DB was
        `db:reset` first because it held 41 stale products (94 variants)
        from an older, superseded fixture (bundle/"copy-of-" slugs from
        2.2-era verification) — a clean import was the only way to make
        counts assertable. Re-ran the full `npm run verify` gate against
        the imported data: 30 files, 244 tests, 99.14% coverage, build
        green.
        NOTE — discovered during the real import, logged as task 1.5:
        all 5 products imported as `status = 'draft'` even though the
        CSV's `Status` column says `active` and `Published` says `true` —
        the importer never reads those columns. Until 1.5 lands (or an
        admin publishes them via 4.3), the storefront listing renders an
        empty state against this otherwise-correct catalog.

- [x] **1.5 Importer honors CSV `Status`/`Published` columns**
      Deps: 1.4b. Discovered during the first real `--apply` (2026-07-22):
      `parseShopifyCsv` ignored the `Status`/`Published` columns, so every
      imported product landed as `draft` and the storefront showed an empty
      catalog against a correct import.
      `ParsedProduct` gained `status: ParsedProductStatus`
      (`draft | published | archived`), derived on the first row per handle
      by a new `parseStatus` helper: `archived` → `archived`;
      `active` → `published` **unless** `Published` is literally `false`
      (Shopify keeps them as separate columns and `Published: false` +
      `Status: active` means "not on the online channel" — resolved to
      `draft`, the safe direction); anything else (missing column, blank,
      unknown value) → `draft`, permissive-parse convention, never a row
      error. `catalog-import.ts`: `productChanged` now compares `status`,
      and both the create and update paths write `parsed.status` — so a
      status-only change diffs as `update`, and re-importing after an admin
      unpublishes WILL republish (CSV wins; the importer is a full-sync
      tool, consistent with how it already overwrites name/description).
      Tests: 4 new parser cases (active+true → published; draft/archived
      passthrough; active+Published:false → draft; missing/blank/unknown →
      draft) and 2 new integration cases (create writes parsed status;
      status-only change reports and applies `update`) — all confirmed red
      first (`status` undefined / action `unchanged`) before implementing.
      AC met, verified live: re-ran `npm run import-catalog --
tests/fixtures/catalog.csv --apply` — all 5 products diffed `[update]`
      and flipped to `published` (psql-confirmed), and a real `next dev` +
      `curl /products` rendered all 5 product cards (each "Out of stock" —
      correct, the CSV has no `Variant Inventory Qty` column, so initial
      import movements are delta 0). `npm run verify` green: 30 files, 250
      tests, 99.15/96.44/100/99.12% coverage, build passes.
      NOTE for 4.4 (inventory management): the catalog is live but every
      variant has 0 stock — real starting counts need either a manual
      `inventory_movements` adjustment (admin UI, 4.4) or a future CSV with
      `Variant Inventory Qty` populated. Nothing is sellable until then,
      which is fine pre-checkout (cart is 2.7, payments are phase 3).

- [x] **1.6 Importer populates filter facets (attributes + categories)**
      Deps: 1.5. `ParsedProduct` (1.4a, `catalog-importer.ts`) gained
      `attributes: ParsedAttribute[]` (`{key, value}`). `OptionN Name`
      appears once per product (its first CSV row, alongside Title/Tags —
      confirmed against the real fixture, not assumed); `OptionN Value`
      repeats per variant row. Parsing keeps two handle-keyed maps
      alongside `productsByHandle`: `optionNamesByHandle` (captured once,
      on product creation, lowercased) and `seenAttributesByHandle` (a
      `Set<"key::value">` per handle) so the same key/value pair seen
      across multiple variant rows (e.g. two SKUs that both come in
      "Balsam Fir") is recorded once, not once per row. (b) category
      fallback: `product.categories` now falls back to `[Type]` when
      `Tags` is blank; `Tags` still wins when present (unchanged from
      before). Both changes are parser-only (pure, no DB) — 1.4b's
      diff/apply layer was untouched for status logic, only extended.
      `src/lib/repos/attributes.ts` gained `replaceProductAttributes`
      (delete-then-reinsert per product id), mirroring `images.ts`'s
      `replaceProductImages` exactly — `product_attributes` has no natural
      upsert key, and replace-not-diff is what makes a changed option
      value (not just a repeated one) idempotent too, not only an
      unchanged one. `catalog-import.ts`'s `importProduct` calls it
      unconditionally on `apply && product`, in the same block as
      `replaceProductImages`, so attributes remain in sync with the parsed
      input on every apply regardless of the product/variant `action`
      classification (create/update/unchanged) — matching how images
      already behave, not a new pattern.
      Tests: 4 new parser cases (dedup across repeated values, a second
      independent `OptionN` pair, `Type` fallback when `Tags` is blank,
      `Tags` wins when both present) plus an `attributes: []` assertion
      added to the existing minimal-CSV case; 2 new `catalog-import.ts`
      integration cases (apply writes attribute rows, re-import with a
      changed value replaces rather than accumulates) plus assertions
      added to the existing create/re-apply-unchanged cases. All confirmed
      red first (missing `attributes` field / no rows written) before
      implementing.
      AC met, verified live against the real dev database: re-ran
      `npm run import-catalog -- tests/fixtures/catalog.csv --apply`
      (all 5 products `[unchanged]`, since this only added facet data);
      `listFilterableAttributeValues("scent")` returns exactly the 9 real
      scents; `listFilterableCategories()` returns `Body Butter, Hair
  Care, Soap, candles` — 4 categories, matching the AC's "4 product
      types" (the `Type` value `Candles` slugifies to `candles`, which
      collided with a category of that same slug/lower-name already
      created by an earlier iteration's `catalog-import.test.ts` runs —
      pre-existing stale data unrelated to this task's code, not a bug:
      `getCategoryBySlug` correctly found and reused it instead of
      creating a duplicate). Ran the apply a second time immediately
      after: `product_attributes` row count held at 45 and
      `product_categories` link count held at 5 — no duplicates.
      `npm run verify` green: 30 files, 260 tests, 98.8/96.15/100/98.75%
      coverage, build passes.
      NOTE: while running `verify`, lint failed on a stray `.open-next/`
      directory (26MB, gitignored, produced by `npm run preview`/`deploy`
      — task 6.0's Cloudflare Workers adapter — but never added to
      `eslint.config.mjs`'s `globalIgnores`). This wasn't caused by 1.6's
      changes but blocked its AC (`npm run verify` must pass), so it's
      fixed in this commit: `.open-next/**` added to `globalIgnores`
      (matching the existing `.next/**`/`out/**`/`build/**` pattern) and
      the stray directory deleted (regenerable via `npm run preview`, not
      committed work). Any future iteration that runs `preview`/`deploy`
      locally will hit this again if it doesn't know to `rm -rf
.open-next` first — now it won't, since lint ignores it.
      NOTE for later cleanup (not blocking, low priority): the stale
      `candles`/`seasonal` categories mentioned above come from
      `catalog-import.test.ts`'s `afterEach`, which deletes
      `product_categories` link rows (via the parent product's cascade)
      but never the `categories` rows themselves — every local test run
      against the dev DB leaves orphaned category rows behind. Harmless
      today (`listFilterableCategories` only returns categories with a
      live published-product link), but worth a follow-up if the category
      table ever needs a uniqueness/cleanup pass.

- [x] **1.7 Made-to-order / oversell support** (owner request, 2026-07-22)
      Deps: 1.3. The shop has no supply yet and wants to sell anyway,
      producing to order — sold-out products stay published and purchasable.
      Two additive columns (migration `0001_mixed_molly_hayes.sql`, applied
      to local dev; expand/contract-safe): `product_variants.allow_backorder`
      (boolean NOT NULL default **true** — everything is made-to-order until
      the owner turns it off per variant) and `order_items.oversold_quantity`
      (integer NOT NULL default 0 — how much of the line exceeded on-hand
      stock at order time; checkout (3.5) must compute
      `max(0, quantity - available)` when it decrements inventory).
      `listPublishedProductsFiltered` gained a `purchasable` aggregate
      (`bool_or(stock > 0 OR allow_backorder)`) alongside the untouched
      literal `inStock`; `ProductListingItem`/`ProductDetailVariant` carry
      `purchasable`/`allowBackorder` through. UI: card + variant selector
      show **"Made to order"** (neutral styling) for zero-stock backorderable
      items, "Out of stock" only when backorder is off; the "In stock only"
      filter stays literal (made-to-order ≠ in stock) — decided so the label
      never lies; revisit if the owner wants it to mean "available to buy".
      Tests: 2 new repo integration cases (purchasable vs inStock,
      literal filter), service passthrough assertions, 1 orders-repo case
      (oversold_quantity persists; default 0 asserted in the existing create
      test), 2 card + 1 selector RTL cases. `specs/02-data-model.md` updated.
      `npm run verify` green: 30 files, 255 tests, 98.95% coverage, build ok.
      NOTE for 3.4/3.5 (checkout): purchasability gate = stock > 0 OR
      allow_backorder; a sale may drive ledger stock negative — that's legal
      now. Order confirmation email (3.7) should probably tell the customer
      the item is made to order — decide lead-time copy with the owner.

---

## Phase 2 — Storefront

- [x] **2.1 Design tokens + layout shell**
      Deps: 0.1. Tailwind v4 keeps tokens in CSS, not a `tailwind.config.ts` —
      `src/app/globals.css`'s `:root`/`@theme inline` blocks now define a
      brand palette (`cream`/`ink`/`clay`/`clay-dark`/`sage`/`sand`) generating
      `bg-cream`, `text-ink`, `bg-clay`, etc. utilities. **These are placeholder
      values** (warm neutrals + a terracotta accent, picked to fit "handmade
      candles + body butter" without real brand input) — everything downstream
      is built against the semantic names, not the hex codes, so swapping in
      the owner's real logo/palette later is a one-file edit, not a rebuild.
      See the "Blocked" entry below, updated to reflect this. Removed the
      scaffold's OS-`prefers-color-scheme` dark-mode flip — a single fixed
      brand palette, not an adaptive one, is the right call for a storefront
      with a defined identity. Type scale/spacing: reused Tailwind v4's default
      scale rather than inventing custom values; nothing in the spec calls for
      a non-default scale yet.
      New `src/components/site-header.tsx` (logo linking `/`, `<nav
aria-label="Main">` with Shop/About/Contact, a `/cart` link whose
      `aria-label` carries a hardcoded `Cart, 0 items` — real count wiring is
      2.7's job, this just proves the indicator slot exists) and
      `src/components/site-footer.tsx` (`<nav aria-label="Policies">` with all
      seven policy links from `specs/03-storefront.md`'s route list). Both are
      plain Server Components (no interactivity yet, so no `"use client"`).
      Wired into `src/app/layout.tsx` around `{children}`, which is now wrapped
      in the page's single `<main>` landmark — moved `src/app/page.tsx`'s own
      top-level element from `<main>` to a `<div>` so pages don't nest a second
      `<main>` inside the layout's.
      `site-header.test.tsx` / `site-footer.test.tsx` (7 RTL tests total):
      logo href, nav landmark + link hrefs, cart indicator accessible name,
      every policy link, and an axe (`jest-axe`) zero-violations assertion per
      component. Confirmed red first (import-resolution error, components
      didn't exist).
      Added `jest-axe` + `@types/jest-axe` as devDependencies. `tests/setup.ts`
      now also calls `expect.extend(toHaveNoViolations)` and, importantly,
      registers `afterEach(cleanup)` from `@testing-library/react` — without
      it, `vitest.config.mts` not setting `test.globals: true` meant RTL's
      auto-cleanup detection didn't kick in, so every test after the first in
      a file left its rendered tree in `document.body`, which made later
      `getByRole` queries match stale duplicates and made axe report
      `landmark-no-duplicate-banner`. This will matter for every future
      component test file, not just these two.
      AC met for the "renders at 360/768/1440 with no horizontal scroll" half
      via a real browser, not jsdom (jsdom has no layout engine to assert
      against): installed Playwright's Chromium (`npx playwright install
chromium`; `--with-deps` failed, no passwordless sudo in this sandbox,
      but the browser-only download didn't need it), ran the dev server, and
      measured `document.documentElement.scrollWidth` vs `clientWidth` at all
      three widths — equal (no overflow) at each, screenshots visually
      confirmed the header/footer wrap sanely with no clipped content.
      Also fixed a pre-existing, unrelated failure hit while running
      `npm run verify`: `tests/unit/docker-compose.test.ts`'s
      `db:reset`-script-exists regex (`/node\s+(\S+\.mjs)/`) predated
      aeaecb4's `node --env-file=.env.local scripts/db-reset.mjs` change and
      no longer matched with the flag in between — confirmed this was already
      broken on `main` before this task (same failure on `git stash`), fixed
      the regex to tolerate `--flag` tokens between `node` and the script
      path rather than touching the flag itself.
      Full `npm run verify` green: 17 files, 97 tests, 99.57%/98.36%/100%/
      99.56% coverage (global 80% floor, 90% floor for services — both clear),
      build passes.

- [x] **2.2 All-products page**
      Deps: 1.3, 2.1. `src/app/(storefront)/products/page.tsx` — async Server
      Component, `export const dynamic = "force-dynamic"` (catalog/stock
      change independently of deploys per AGENT.md's "database is the source
      of truth for catalog and inventory" — without this the route got
      statically prerendered at build time, confirmed by `next build`'s
      route table showing `○ /products` before the fix and `ƒ /products`
      after; a real bug caught by actually reading `npm run build` output,
      not just green tests).
      New service `src/lib/services/product-listing.ts` —
      `getPublishedProductListing()`: three queries total regardless of
      catalog size (products, batch active-variants-by-product-ids, batch
      primary-images-by-product-ids) plus a batch stock lookup via the
      existing `getStockForVariants` — never N+1 per product. Computes
      `priceFromCents` (min active-variant price, `null` if none) and
      `inStock` (any active variant with summed stock > 0) per product.
      Two new batch repo functions, following the existing
      `getStockForVariants` "absent key = zero/none" convention: `src/lib/
repos/variants.ts`'s `listActiveVariantsByProductIds` and `src/lib/repos/
images.ts`'s `listPrimaryImagesByProductIds` (uses `db.selectDistinctOn`,
      not a method on the query object — this drizzle version
      (`0.45.2`) exposes it only as `db.selectDistinctOn([cols]).from(...)`,
      confirmed by inspecting the built package since the typed `.d.ts`
      chain has no `.distinct()`/`.distinctOn()` instance method).
      `src/lib/repos/products.ts`'s `listProducts` now orders
      `desc(createdAt)` by default (newest-first, matching the spec's
      default `sort=newest` and the `products_status_created_at_idx` index
      that already existed for exactly this) — additive, doesn't break any
      existing `toContain`-style test.
      New pure util `src/lib/format.ts` — `formatPriceCents` (`Intl.
NumberFormat` cents→`"$19.99"`), and two presentational components:
      `src/components/product-card.tsx` (image or "No image" placeholder,
      name linking `/products/[slug]`, price-from, "Out of stock" label) and
      `src/components/product-grid.tsx` (renders a `<ul>` of cards or an
      empty-state message — the spec's "every list has an empty state").
      Plain `<img>`, not `next/image` — no image hosting/remote-pattern
      config exists yet (real R2 hosting is 4.5's job, `next/image` sizing
      is 5.4's); an `eslint-disable` on that line names both.
      Tests: `product-listing.test.ts` (6 integration tests against the real
      dev database — excludes draft/archived, price-from ignores deactivated
      variants, out-of-stock/in-stock via real `inventory_movements` rows,
      no-variants product has `null` price and is out-of-stock, primary
      image by lowest position or `null`), `format.test.ts` (3 unit tests),
      `product-card.test.tsx` / `product-grid.test.tsx` (12 RTL tests
      including `jest-axe`), `products/page.test.tsx` (2 tests — an async
      Server Component is invoked and awaited directly,
      `render(await ProductsPage())`, then asserted with RTL like any other
      component; this is the pattern future storefront route tests should
      follow), plus new batch-function tests in `variants.test.ts`/
      `images.test.ts`/`products.test.ts`. Confirmed every new test red for
      the right reason (import-resolution or assertion failure against
      not-yet-written code) before implementing.
      AC met, verified two ways: the test suite above, and a real browser —
      seeded the dev DB via `npm run import-catalog -- tests/fixtures/
catalog.csv --apply` (all rows import as `draft` by default), published
      three products directly in Postgres, ran `next dev`, and used
      Playwright's CLI screenshot (`npx playwright screenshot`) against
      `localhost:3000/products`: the three published products rendered with
      name/price-from/"Out of stock", the ~35 still-draft products (e.g.
      "Bar Soap", "Wax Melts") were absent from the HTML entirely (confirmed
      via `curl | grep`, not just visually), and adding a real
      `inventory_movements` row for one variant flipped its card from
      "Out of stock" to no badge on a second screenshot. Reverted both
      manual DB changes afterward. `npm run verify` green: 22 files, 125
      tests, 99.63%/97.94%/100%/99.63% global coverage (`product-listing.ts`
      itself 94/80/100/94 stmts/branch/funcs/lines — the one uncovered
      branch is the empty-catalog early return, not covered because
      asserting "zero published products" against a shared dev database that
      other test files write to would be flakiness bait, not a real test;
      the aggregate `src/lib/services/**` threshold, which is what the gate
      actually enforces, clears 90% easily), build passes.
      NOTE for 2.3: `getPublishedProductListing`'s three-query shape is the
      thing to extend with `WHERE`/`ORDER BY`/`LIMIT` for filter/sort/
      pagination, not replace — the batch-map pattern for variants/images/
      stock still applies once a `WHERE` clause narrows which products come
      back first.
      NOTE for 2.5/2.6: no product-detail route exists yet, so `ProductCard`
      links to `/products/[slug]` paths that 404 today — expected, that's
      2.5's job.

- [x] **2.3 Sort and filter**
      Deps: 2.2. See `specs/03-storefront.md`.
      New `src/lib/validation/product-filters.ts` — the first module in
      `src/lib/validation/` (named in AGENT.md's layout but unused until
      now). `parseProductFilters(raw)` turns Next's `searchParams` object
      into a fully-defaulted `ProductFilters`, permissively: unknown keys
      ignored, non-numeric/negative prices ignored, unknown `sort` falls
      back to `"newest"`, a repeated single-value param (e.g. two `sort`s)
      takes the first. `inStockOnly` is presence-only per the spec's Notes
      column — `?inStock=false` still counts as "on" because the UI only
      ever omits the param or sends `inStock=true`, it never sends
      `false`. `filtersToSearchParams(filters)` is the inverse — canonical
      query-string round-trip, used to build chip-removal/clear-filters
      links without any hand-assembled query strings.
      `src/lib/repos/products.ts`'s new `listPublishedProductsFiltered(filters)`
      does the actual SQL: one query, `products` LEFT JOIN a per-product
      aggregate subquery over active variants (`min(price_cents)` +
      `bool_or(stock > 0)`, the latter joined through the existing
      `variant_stock` view) for price-from/in-stock, plus one `EXISTS`
      condition per active facet (category via `product_categories` join,
      scent/size via `product_attributes` key/value) so different facets
      AND together (separate conditions) while values within one facet OR
      together (`inArray` inside a single EXISTS). Price range is
      deliberately **not** filtered against the aggregated minimum — a
      separate EXISTS on `product_variants` checks whether _any_ active
      variant's price falls in `[min, max]`, because a multi-variant
      product can have one variant in range and a cheaper one outside it
      (spec: "matches if any variant falls in the range"). This also means
      `minPrice > maxPrice` needs no special-cased branch: no variant can
      satisfy both bounds at once, so it naturally yields zero rows, not
      an error. Sort is `price_asc`/`price_desc` (on the aggregated
      min-price column) / `name_asc` / `newest` (default), always
      tie-broken on `products.id` for stable pagination ahead of 2.4.
      Two new repo helpers feed the filter UI's facet options, both scoped
      to published/non-deleted products so an empty facet never renders as
      a selectable-but-empty checkbox: `categories.ts`'s
      `listFilterableCategories()` and a new `src/lib/repos/attributes.ts`
      (`setProductAttribute`, `listFilterableAttributeValues(key)`) — the
      first repo module for `product_attributes`, which had none before
      this task.
      `product-listing.ts` service: replaced `getPublishedProductListing()`
      with `getFilteredProductListing(filters: ProductFilters)` (same
      two-query shape as before — filtered/sorted products, then one batch
      image lookup — collapsed from three queries since price-from/in-stock
      are now computed in the repo's SQL instead of a second batch call)
      plus a new `getFilterFacets()` (categories/scents/sizes in parallel).
      This is an extension of the existing 2.2 function per the loop's own
      "search before creating a sibling" rule, not a parallel
      implementation — the default-filters case (`parseProductFilters({})`)
      reproduces the old unfiltered/newest-first behavior exactly, and all
      of 2.2's existing service/page tests were migrated to call the new
      function rather than duplicated.
      UI: new `src/components/product-filters-form.tsx` — a plain
      `method="GET" action="/products"` `<form>`, no client JS at all.
      Checking a facet checkbox or clicking "Apply filters" is an ordinary
      browser navigation to a new query string, which is what makes filter
      state live entirely in the URL and keeps working with JS disabled.
      Wrapped in `<details open>` for the "Filter button with an active
      count" requirement — free keyboard/screen-reader toggle semantics
      with zero JS. Active filters render as removable chips (each an
      `<a>` to the current filter set minus that one value, computed via
      `filtersToSearchParams`) plus a "Clear all" link to `/products`.
      `products/page.tsx` now takes `searchParams: Promise<RawSearchParams>`
      (Next 15+'s async page props), parses it once, and passes the same
      `filters` object to both the form (to pre-check/pre-fill controls)
      and the service. `ProductGrid` gained optional `emptyMessage`/
      `emptyAction` props so the page can show "No products match your
      filters." + a working "Clear filters" link when filters produced zero
      results, vs. the generic "check back soon" message for a genuinely
      empty catalog — same component, two empty states, per the spec's
      distinct empty-state requirement.
      Tests: `product-filters.test.ts` (17 unit tests — defaults, single
      and repeated facet values, blank-value dropping, whole/fractional
      price parsing, invalid/negative price ignored, `inStock` presence
      semantics, every sort value plus unknown-sort fallback, unknown
      params ignored, round-trip serialization); `products.test.ts` gained
      19 integration tests on `listPublishedProductsFiltered` (draft/
      archived excluded, category alone, category OR'd across two values,
      scent alone, size alone, price range matching _any_ variant not just
      the cheapest, minPrice-only, maxPrice-only, inverted range → empty
      not an error, in-stock-only, category AND in-stock combined, all
      four sorts including tie-break-by-id and default, empty-result case,
      result shape); `attributes.test.ts` (4 new tests) and 1 new test in
      `categories.test.ts` for the two facet-option repo functions;
      `product-listing.test.ts` migrated plus 2 new tests (filters actually
      applied through the service, `getFilterFacets` shape);
      `product-filters-form.test.tsx` (11 RTL + axe tests: GET-form
      attributes, checkbox checked-state from current filters, price/
      in-stock/sort pre-fill, chip rendering and correct removal hrefs for
      every facet type, price-chip "any" label when only one bound is set,
      zero axe violations both with and without active filters);
      `product-grid.test.tsx` gained 1 test for the new empty-state props;
      `products/page.test.tsx` migrated to the async `searchParams` prop
      plus 3 new tests (category filter via real query params, filtered
      empty state with working clear-filters link, unknown param ignored).
      AC met, verified two ways: the test suite above (179 tests total,
      `npm run verify` green — 99.46/98.29/100/99.45%
      stmts/branch/funcs/lines, comfortably over both the 80% global and
      90% services floors), and a real `next dev` server hit with `curl`
      against seeded data — full listing showed all 3 seeded products,
      `?category=<slug>` narrowed to exactly the 2 linked ones, an unknown
      category slug produced the "No products match your filters." empty
      state with a working `/products` clear-filters link, and
      `?utm_source=newsletter` was silently ignored (still showed all 3).
      Scratch data removed from the dev DB afterward.
      NOTE — deferred, not part of this AC: the spec's UI section calls for
      a mobile **bottom sheet** (an overlay) vs. a **desktop sidebar** —
      two distinct layouts. This task ships one `<details>` disclosure at
      every viewport width instead (open by default, collapsible via its
      `<summary>`), because a real bottom-sheet-vs-sidebar split needs
      either client JS or duplicated markup gated by responsive `hidden`
      classes (rejected — duplicate `name="category"` inputs across two
      copies of the same form would double-submit and confuse assistive
      tech). If the owner wants the literal bottom-sheet interaction later,
      that's a follow-up task, not a gap in this one's AC (filter
      correctness, URL state, empty states, and accessibility are all met
      by the current markup).
      NOTE for 2.4 (pagination): `page` is in the spec's query-param table
      but deliberately not parsed by `product-filters.ts` yet — no
      pagination logic exists to consume it, and an unhandled param is
      already "ignored" by design. `filtersToSearchParams` is what 2.4
      should extend (not replace) for building page-link hrefs that
      preserve the active filters — same rationale as 2.2's NOTE about
      extending `getPublishedProductListing`'s query shape rather than
      replacing it, which is exactly what happened here.
      NOTE for later phases: `product-filters-form.tsx`'s price sort
      (`price_asc`/`price_desc`) orders by the aggregated `variant_agg.
priceFromCents`, which is `NULL` for a product with zero active
      variants. Postgres' default null-ordering (`NULLS LAST` for `ASC`,
      `NULLS FIRST` for `DESC`) means a no-variant product would jump to
      the _top_ of a `price_desc` listing — not wrong exactly (there's no
      real price to sort it by) but worth knowing if it ever looks like a
      bug in a real catalog with unfinished/variant-less draft-turned-
      published products.

- [x] **2.4 Pagination**
      Deps: 2.3. `src/lib/validation/product-filters.ts` gained
      `PRODUCTS_PAGE_SIZE = 24` and a `page` field on `ProductFilters`
      (1-based, default 1 — non-numeric/zero/negative/fractional all fall
      back to 1, same permissive-parsing convention as every other filter).
      `filtersToSearchParams` omits `page` when it's 1, matching how `sort`
      already omits its default.
      `src/lib/repos/products.ts`'s `listPublishedProductsFiltered` gained
      **`limit`/`offset`, not a `page` number** — deliberately a raw
      primitive, not pagination-aware itself. Omitting `limit` returns every
      match unpaginated (zero behavior change for any of the 19 pre-existing
      callers that never set it). The existing `desc(createdAt), asc(id)`-
      style tie-break (2.3) is what makes LIMIT/OFFSET pages stable.
      `src/lib/services/product-listing.ts`'s `getFilteredProductListing`
      changed return type from `ProductListingItem[]` to
      `{ items, hasNextPage }` (`ProductListingPage`) — it requests
      `limit: PRODUCTS_PAGE_SIZE + 1, offset: (filters.page - 1) *
PRODUCTS_PAGE_SIZE` from the repo and slices the extra row off itself
      to compute `hasNextPage` without a second COUNT query. All existing
      callers/tests migrated to destructure `.items`.
      New `src/components/product-pagination.tsx` — plain Prev/Next `<a>`
      links (no client JS), hrefs built via `filtersToSearchParams({
...filters, page: n })` so every active filter round-trips onto both
      links; renders nothing when there's only one page. Wired into
      `products/page.tsx` below `ProductGrid`.
      Tests: 6 new cases in `product-filters.test.ts` (page parsing/
      defaulting/serialization), 2 new repo tests in `products.test.ts`
      (LIMIT/OFFSET + id tie-break with 5 same-`createdAt` products scoped
      to a throwaway category so cross-file DB pollution can't affect it,
      plus an offset-defaults-to-0 case), 2 new service tests in
      `product-listing.test.ts` (`hasNextPage` false on a single page;
      `page` 2 with `PRODUCTS_PAGE_SIZE + 1` seeded rows proving the filter
      carries across pages and the boundary is exact), 6 new component
      tests in `product-pagination.test.tsx` (incl. axe), 1 new integration
      test in `products/page.test.tsx` (25 rows in a category, `?page=2`
      renders the 1 spillover item with a working, filter-preserving
      Previous link and no Next link).
      AC met, verified two ways: the test suite above, and a real
      `next dev` server — seeded 25 published products in a throwaway
      category via `docker exec psql`, confirmed page 1 shows 24 with a
      `Next` link to `...&page=2`, page 2 shows the 1 remaining item with a
      `Previous` link back to `...&category=...` (no `page` param, since
      page 1 is the default) and no `Next` link, and page 3 renders the
      normal "No products match your filters." empty state (not a crash) —
      each rendering the category filter correctly preserved. Scratch data
      removed from the dev DB afterward. `npm run verify` green: 26 files,
      199 tests, 99.49/98.41/100/99.47% coverage (products.ts and every
      touched service/component file at 100%), build passes,
      `/products` still `ƒ` (dynamic).
      NOTE — real bug caught mid-implementation, worth remembering: an
      earlier version of this task tried to reuse a single `pageSize` value
      for both the repo's LIMIT and its OFFSET-per-page math, passing
      `pageSize: PRODUCTS_PAGE_SIZE + 1` from the service to get the
      hasNextPage peek row "for free." That's wrong — offset needs to
      advance by the _real_ page size (24) while limit needs to be one
      larger (25), and a single shared value can't be both. It silently
      skipped an entire page's worth of rows on `page=2` (offset became
      `(2-1)*25=25` against a 25-row result set, returning nothing). Caught
      by the service-level pagination test, not the repo-level one — the
      repo tests passed explicit small `pageSize` values per page and never
      exercised the peek-trick's page-2 arithmetic. This is why the repo
      API ended up as raw `limit`/`offset` instead of `page`/`pageSize`:
      the primitive that can't silently conflate two different numbers is
      safer than the convenient one. If a future task adds `page`/`pageSize`
      sugar on top of the repo again, keep the peek's limit and the
      stride's offset computed from two independent size values, not one.
      NOTE — dev-DB pollution risk considered and mitigated: this repo's
      integration tests share one live dev database across
      concurrently-run vitest files (12 workers on this sandbox's CPU
      count), and the pre-2.4 filter/listing tests got away with `toContain`
      assertions against an _unpaginated_ result set regardless of what
      else was in the database at that instant. Pagination changes that —
      a LIMIT-24 query scoped to "all published products" could
      legitimately drop a test's own row off page 1 if enough _other_
      concurrently-running test files' published products momentarily
      outrank it in `desc(createdAt)` order. Every new pagination test
      above scopes its query to a throwaway category (or, for the two
      largest tests, accepts the O(25) product-creation cost) specifically
      so pagination correctness never depends on how many other published
      products exist elsewhere in the shared database at test time. Any
      future test against `listPublishedProductsFiltered`/
      `getFilteredProductListing` with an explicit `page`/`limit` should
      follow the same category-scoping pattern, not just `toContain`.

- [x] **2.5 Product detail page**
      Deps: 1.3, 2.1. `src/app/(storefront)/products/[slug]/page.tsx` — async
      Server Component, `export const dynamic = "force-dynamic"` (same
      rationale as 2.2's listing page; confirmed `ƒ` not `○` in `next
build`'s route table).
      New `src/lib/services/product-detail.ts` — `getProductDetail(slug)`
      returns `null` for anything the storefront shouldn't reach by a
      guessed URL (unknown slug, draft, archived, or soft-deleted — mirrors
      2.2/2.3's "published, non-deleted only" contract), otherwise the full
      product (description/ingredients/safetyInfo/careInfo verbatim from
      `products`), every active variant (sorted by `position`, each with
      live stock via the existing batch `getStockForVariants`), every image
      (new repo fn, see below), and every `product_attributes` row grouped
      by key into `Record<string, string[]>` (e.g. `{ scent: ["lavender"],
burn_time: ["40 hours"] }` — there is no dedicated `burn_time` column;
      candles that need one just get a `product_attributes` row with that
      key, same open-ended mechanism 2.3 already uses for `scent`/`size`).
      Two new repo functions, both following existing batch/single-item
      conventions: `src/lib/repos/images.ts`'s `listImagesByProductId`
      (single product, all images ordered by position — a gallery, unlike
      `listPrimaryImagesByProductIds`'s one-per-product batch lookup for
      listing cards) and `src/lib/repos/attributes.ts`'s
      `listAttributesByProductId` (every key/value for one product,
      unfiltered by key — unlike the existing
      `listFilterableAttributeValues(key)` which is scoped to one key
      across all products for the filter UI's facet options).
      New `src/components/product-gallery.tsx` (server, no JS) — every
      image is rendered at once (primary large, rest as a thumbnail row);
      no click-to-swap main-image interaction, since that would need client
      JS or duplicated markup and isn't required by the AC. Placeholder
      shown for a product with zero images.
      New `src/components/variant-selector.tsx` (`"use client"`) — the
      interactive half of the page. A `<form method="GET"
action={/products/[slug]}>` wrapping a `<select>` (pre-populated from
      the initially-selected variant, one `<option>` per active variant)
      plus an always-visible "Update" submit button — same progressive-
      enhancement pattern as `ProductFiltersForm` (2.3): the GET-form
      fallback isn't hidden behind a JS check, it's just also enhanced.
      Selecting a variant updates local React state (price, stock, shipping
      weight) instantly and calls `window.history.replaceState` to sync the
      `?variant=sku` URL — deliberately NOT `next/navigation`'s
      `router.replace`, which would re-fetch the RSC payload from the
      server and violate the "without a full reload" AC. A disabled
      "Add to cart" button is present (cart doesn't exist until 2.7) with a
      `title="Cart is coming soon"` — real wiring is 2.7's job, not
      guessed at here.
      `products/[slug]/page.tsx` reads `?variant=` server-side too (for the
      no-JS/first-paint case and for direct deep-links): looks up a
      matching active variant by SKU, falls back to the first active
      variant (by position) if the param is missing or doesn't match any
      SKU on this product. Below the fold: a `<dl>` built from whichever of
      description/ingredients/burn_time/safetyInfo/careInfo are actually
      present (each optional — a body-butter product with no burn_time
      attribute just doesn't get that row) plus a static "Ships within 1–2
      business days" shipping-summary line.
      404 handling: `next/navigation`'s `notFound()`, called for unknown
      slugs and for slugs that exist but resolve to a non-published/
      deleted product (draft-leakage-by-guessed-URL is a real bug class,
      same principle as 06-testing.md's must-have #6 for the listing page,
      so it's tested here too even though the AC only names "unknown
      slug"). No custom `not-found.tsx` exists yet (that's 5.3), so this
      renders Next's default 404 — sufficient for the AC ("404 for unknown
      slug"), which is about status/behavior, not a branded error page.
      Tests: `images.test.ts` (+2), `attributes.test.ts` (+2) for the new
      repo functions; `product-detail.test.ts` (8 integration tests against
      the real dev database — null for unknown/draft/deleted, full
      assembly with images/variants/attributes, deactivated variants
      excluded, zero-movement variant reads as 0 stock, variants sorted by
      position regardless of insertion order, empty attributes object);
      `product-gallery.test.tsx` (3 RTL + axe); `variant-selector.test.tsx`
      (7 RTL + axe, including a `user-event` `selectOptions` interaction
      asserting price/stock text change AND `window.location.search`
      change with no navigation, an empty-variants "Currently unavailable"
      state, and the disabled add-to-cart button); `products/[slug]/
page.test.tsx` (6 integration tests, same "invoke the async Server
      Component directly and await it" pattern as `products/page.test.tsx`
      — full render, `?variant=` selecting a specific SKU, unknown
      `?variant=` value falling back to the first variant, a burn_time
      attribute rendering, and the two 404 cases asserted via
      `.rejects.toThrow()` since `notFound()` throws a special digest error
      that the real App Router turns into a 404 response — this test can't
      spin up a full Next server, so asserting the throw is the correct
      boundary for an integration test at this level, and the live-browser
      check below is what proves the actual HTTP status).
      AC met, verified two ways: the test suite above (30 files, 226 tests,
      99.11/96.87/100/99.08% global coverage — `product-detail.ts` and
      `product-gallery.tsx`/`variant-selector.tsx` individually clear the
      90% services/component floor easily), and a real `next dev` server
      hit with `curl` against a manually-seeded product (two variants, one
      image, a `burn_time` attribute, one inventory movement): the base
      page rendered name/description/ingredients/price/stock/burn_time/
      image, `?variant=MTC-16OZ` server-rendered the $40.00 variant's price
      instead of the default $24.00, `GET /products/no-such-slug-at-all`
      returned HTTP 404, and flipping the seeded product to `status =
'draft'` and re-requesting its real slug also returned HTTP 404 (not
      leaked). Scratch data removed from the dev DB afterward. `npm run
verify` green (lint, typecheck, test:coverage, build — `/products/
[slug]` shows `ƒ` not `○` in the build's route table, confirming it
      isn't statically prerendered).
      Unrelated pre-existing lint failure fixed in passing:
      `src/components/product-grid.test.tsx` had a raw `<a href="/products">`
      in its "custom empty action" test, which `eslint-config-next`'s
      `no-html-link-for-pages` rule started flagging only once this task's
      new `/products/[slug]` route existed for the rule to cross-reference
      against (confirmed via `git stash` that `main` lints clean without
      this task's new page, and fails with the exact same error once it's
      added back) — swapped the test's raw `<a>` for `next/link`'s `Link`,
      identical test behavior, matching how the real app already builds
      that same link in `products/page.tsx`.
      NOTE for 2.6 (SEO): no `generateMetadata` was added to this page —
      out of scope for 2.5's AC (which is about interactivity/no-reload/
      404, not metadata), and 2.6 is explicitly where per-page metadata,
      OG images, and JSON-LD land. Don't duplicate a partial metadata
      implementation here first.
      NOTE for 2.7 (cart): the "Add to cart" button is a real, visible,
      disabled button — not a TODO comment — so the layout/spacing is
      already correct when 2.7 wires it up. It has no `type="submit"`
      inside the variant-select form (it's `type="button"`, outside any
      form action) specifically so 2.7 can attach its own submit handler
      without fighting the GET-form's own submit button.
      NOTE for 4.3/4.4 (admin): `burn_time` (and any other candle/body-
      butter-specific fact) is stored as a `product_attributes` row, the
      same mechanism as the existing `scent`/`size` filter facets — there
      is no dedicated schema column and none should be added for
      single-value display-only facts like this one. The admin product
      form will need a way to set arbitrary attribute keys, not just
      scent/size.

- [ ] **2.6 SEO + structured data**
      Deps: 2.5. Per-page metadata, OG images, `Product` + `Offer` JSON-LD,
      `sitemap.xml`, `robots.txt`, canonical URLs.
      AC: JSON-LD validates; sitemap lists every published product; filtered
      listing URLs are `noindex` to avoid crawl bloat.
      Split into sub-tasks below (five distinct pieces of work bundled into
      one bullet — same rationale as 1.3/1.4's splits). This umbrella item is
      ticked `[x]` only once all four below are `[x]`.

  - [x] **2.6a Per-page metadata, canonical URLs, noindex for filtered listings**
        Deps: 2.5. `products/page.tsx` gains `generateMetadata` (title,
        description, `alternates.canonical: "/products"` unconditionally —
        a filtered/paginated listing is still the same logical resource, so
        it self-consolidates rather than growing a canonical per query
        string) plus `robots: { index: false, follow: true }` whenever any
        facet/price/in-stock filter is active. `sort` and `page` do NOT
        count as "active" for this purpose — sort just reorders the same
        result set, and pagination pages of the plain listing are still
        worth indexing; only a narrowing facet/price/in-stock filter makes
        a page a crawlable near-duplicate.
        `products/[slug]/page.tsx` gains `generateMetadata` (title = product
        name, description = `truncateForMeta(detail.description)` — new pure
        helper in `src/lib/format.ts`, collapses whitespace/newlines then
        cuts at a word boundary under 160 chars with a trailing `…`,
        following the same "small pure util" pattern as `formatPriceCents`;
        returns `null` for a `null` description, matching `ProductDetail`'s
        typing exactly rather than coercing to `""`), `alternates.canonical:
"/products/{slug}"` — deliberately without `?variant=`, since the
        variant selector (2.5) is UI state on one resource, not a distinct
        page, so switching variants must never change what search engines
        treat as canonical. An unknown slug's `generateMetadata` returns
        `{}` (falls back to the root layout's defaults) rather than
        duplicating the `notFound()` decision the page component already
        makes — Next calls both independently, and only the page component
        actually needs to throw.
        Extracted the existing inline "any filter active?" boolean —
        previously duplicated as a five-line `||` chain directly in
        `page.tsx`'s empty-state/clear-filters logic — into
        `product-filters.ts`'s new exported `hasActiveFilters(filters)`, so
        `generateMetadata`'s `noindex` decision and the page body's
        empty-state copy share one definition instead of two that could
        silently drift apart (e.g. someone adding a new facet to one branch
        and forgetting the other).
        Tests: 8 new cases in `product-filters.test.ts` (default/page-only/
        sort-only are all "not active"; each facet type and each price
        bound individually make it "active"); 5 new cases in `format.test.ts`
        (null passthrough, short text unchanged, long text truncated to a
        word boundary with `…`, newline collapsing); 4 new cases in
        `products/page.test.tsx` (indexable + self-canonical by default,
        stays indexable with only sort/page set, noindex for a facet filter,
        noindex for a price filter); 2 new cases in `products/[slug]/
page.test.tsx` (title/description/canonical for a real published
        product, `{}` for an unknown slug). All new test files confirmed red
        first (`generateMetadata`/`hasActiveFilters`/`truncateForMeta` not a
        function) before implementing.
        AC met: `npm run verify` green — 30 files, 244 tests, 99.14/96.33/
        100/99.11% coverage (global 80% floor and the `src/lib/services/**`
        90% floor both clear easily; the two newly-uncovered branches in
        `[slug]/page.tsx`, lines 54/57, are the pre-existing
        `safetyInfo`/`careInfo` optional-field branches from 2.5, unrelated
        to this task), build passes, `/products` and `/products/[slug]`
        still `ƒ` (dynamic) in the route table.
        NOTE for 2.6b (JSON-LD): the canonical URL logic now lives in two
        places (`generateMetadata` in each page) as a literal template
        string (`` `/products/${detail.slug}` ``) — 2.6b's `Offer.url` should
        reuse that same shape (and ideally the same `NEXT_PUBLIC_SITE_URL`-
        prefixed absolute form sitemap/OG will also need in 2.6c/2.6d) rather
        than re-deriving it a third way. If a third consumer shows up, that's
        the signal to extract a small `productUrl(slug)` helper — two
        call sites inline was not yet worth the abstraction.
        NOTE for 2.6c (sitemap): `hasActiveFilters` is the right function to
        reuse if the sitemap generator ever needs to reason about which
        `/products` query variants exist — it should not need to, since the
        sitemap only ever lists the bare canonical paths, but flagging the
        connection in case scope grows.

  - [x] **2.6b `Product` + `Offer` JSON-LD**
        Deps: 2.6a. New pure module `src/lib/seo/product-json-ld.ts` —
        `buildProductJsonLd(detail: ProductDetail, selectedSku, siteUrl)`
        returns a schema.org `Product` object (name, `description` omitted
        — not `null` — when the product has none, `image` = every image
        URL, `sku` = the selected variant's SKU) with a nested `Offer`
        (`price` as a plain decimal string via `(cents/100).toFixed(2)`, not
        `formatPriceCents`'s `"$24.00"` — schema.org wants a bare number
        string, not a currency-formatted one; `priceCurrency: "USD"`; `url`
        = `${siteUrl}/products/{slug}`, deliberately without `?variant=`,
        matching 2.6a's canonical). `availability` is a 3-way map over the
        selected variant's live stock/`allowBackorder` (1.7): `stock > 0` →
        `https://schema.org/InStock`; `stock <= 0 && allowBackorder` →
        `https://schema.org/BackOrder` (a real schema.org `ItemAvailability`
        enum member — chosen over `OutOfStock` because 1.7's "Made to
        order" UI copy would otherwise contradict the structured data);
        else → `https://schema.org/OutOfStock`. Falls back to the first
        variant when `selectedSku` matches none, mirroring the page
        component's own fallback. Returns `null` (page renders no script
        tag at all) when `detail.images` is empty or there are no variants
        — schema.org's required `image`/`offers` fields can't be populated
        validly, so emitting a JSON-LD block that fails validation would be
        worse than omitting it.
        `products/[slug]/page.tsx` calls it with `env.NEXT_PUBLIC_SITE_URL`
        (server-side read of the full merged `env`, same pattern as
        `layout.tsx`'s `metadataBase`) and the page's already-computed
        `initialSku`, and renders the result via
        `dangerouslySetInnerHTML`/`JSON.stringify` inside a `<script
type="application/ld+json">` — confirmed via `npx eslint` that this
        repo's flat config has no `react/no-danger` rule active, so no
        disable comment is needed (added one first, then removed it after
        lint reported it as an unused directive).
        Tests: `product-json-ld.test.ts` (7 unit tests — full valid graph
        incl. a `JSON.parse(JSON.stringify(...))` round-trip, BackOrder vs.
        OutOfStock for the two zero-stock cases, selectedSku-not-found
        fallback, description omitted not nulled, null return for
        zero-images and zero-variants); 2 new cases in `products/[slug]/
page.test.tsx` (the full-product test now also parses
        `document.querySelector('script[type="application/ld+json"]')`'s
        `innerHTML` and asserts the whole object via `toMatchObject`; a new
        case asserts no script tag at all for a product with no images).
        All confirmed red first (import-resolution error for the new
        module; no script element found in the DOM for the page test)
        before implementing.
        AC met: the JSON-LD parses as valid JSON (round-trip test) and
        contains every schema.org-required field (`name`, `image`, `offers`
        with `price`/`priceCurrency`/`availability`).
        Unrelated pre-existing failure fixed in passing (blocked this
        task's `npm run verify`, confirmed via `git stash` that it already
        failed on `main`): `attributes.test.ts`'s "lists distinct values
        for a key" test asserted `listFilterableAttributeValues("scent")`
        equals exactly `["lavender", "vanilla"]` — true when the dev
        database was empty, false now that the real catalog import (1.4b/
        1.6, closed 2026-07-22) permanently seeded 9 real Title Case scent
        values into the same shared dev database this test runs against.
        Fixed by reading a baseline before inserting the test's own
        lowercase values and asserting the delta (`arrayContaining` the two
        new values, length grew by exactly 2) instead of the whole table's
        contents — the same "shared dev database, don't assert global
        emptiness" lesson 1.6's own NOTE already flagged for
        `listFilterableCategories`, just not yet applied here.
        `npm run verify` green: 31 files, 268 tests, 98.83/96.3/100/98.77%
        coverage (global 80% floor and `src/lib/services/**`/`src/lib/
stripe/**` 90% floor both clear; `product-json-ld.ts` itself 100%
        across the board), build passes, `/products/[slug]` still `ƒ`.
        NOTE for 2.6c (sitemap): no change needed to this module — the
        sitemap only lists bare canonical paths, it doesn't touch JSON-LD.
        NOTE for 2.6d (OG images): `buildProductJsonLd`'s image-array
        source (`detail.images.map(i => i.url)`) is the same image list an
        OG image route would draw its source photo from — don't re-derive
        "the primary image" a third way if 2.6d needs one; reuse
        `detail.images[0]`.

  - [ ] **2.6c `sitemap.xml` + `robots.txt`**
        Deps: 2.5. `src/app/sitemap.ts` (Next's `MetadataRoute.Sitemap`) —
        static routes (`/`, `/products`) plus one entry per published,
        non-deleted product via the existing products repo, each URL built
        from `NEXT_PUBLIC_SITE_URL` + canonical path (no query strings).
        `src/app/robots.ts` — disallow `/admin`, `/api`; reference the
        sitemap.
        AC: the sitemap lists every published product and none that are
        draft/archived/deleted (integration-tested against the dev
        database); `robots.txt` disallows admin/api routes.

  - [ ] **2.6d OG images**
        Deps: 2.6a. Dynamic per-product OG image (`next/og` /
        `ImageResponse`) plus a static default for non-product pages;
        wired into each page's `generateMetadata` via `openGraph.images`.
        AC: the OG image route renders a valid image response and is
        referenced in the product page's metadata.

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

- [ ] **2.9 Home page**
      Deps: 2.2. Discovered during the 2026-07-22 repo sweep:
      `specs/03-storefront.md`'s route table line 1 is `/` — "home:
      featured products, brand story" — but no task ever replaced the 0.1
      scaffold placeholder ("Storefront under construction"), and every
      other route in that table is covered by 2.2/2.5/2.8. Featured
      products can reuse `getFilteredProductListing` (e.g. newest N
      published); the brand-story copy needs owner input (same human gate
      as 2.8's About page — placeholder-free rule applies), but the
      featured-products section and page structure can land now.
      AC: `/` renders a featured-products section fed by the live catalog
      (no hardcoded product data), links through to `/products` and
      product detail pages, axe-clean, and no longer says "under
      construction". Sitemap (2.6c) already plans to list `/`.

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

- [x] **6.0 Cloudflare Workers adapter wiring** (pulled ahead 2026-07-22 —
      owner connected the git repo to a Cloudflare account and started the
      Workers Builds setup, so the repo needed to be deployable now; the
      full staging AC still belongs to 6.1)
      `@opennextjs/cloudflare@1.20.2` (dependency; peer-supports Next
      16.2.11 exactly) + `wrangler@4.113.0` (dev) + `@neondatabase/serverless`.
      New `wrangler.jsonc` (worker name `fhcwebsite`, `nodejs_compat`,
      assets binding, WORKER_SELF_REFERENCE, observability),
      `open-next.config.ts` (defaults — no ISR cache, catalog routes are
      force-dynamic), `initOpenNextCloudflareForDev()` in `next.config.ts`,
      `preview`/`deploy` npm scripts, `.dev.vars*` gitignored.
      `src/lib/db/client.ts` now picks its driver at module load: on workerd
      (`navigator.userAgent === "Cloudflare-Workers"`) it uses Neon's
      serverless **HTTP** driver (stateless fetch per query — Workers can't
      hold TCP/pg sockets across requests); everywhere else (dev, tests,
      CLI scripts, CI) the existing `pg` Pool. CAVEAT recorded in the file:
      neon-http has no interactive `db.transaction` — fine while all
      Workers-side DB paths are reads; 3.5's order-creation transaction must
      use a per-request WebSocket Pool from `@neondatabase/serverless`.
      GOTCHA (cost an hour): `opennextjs-cloudflare build` failed on
      `Could not resolve "pg-cloudflare"` — Next's output tracing resolves
      pg's optional shim through the exports `default` condition (an empty
      stub) so `dist/index.js` never lands in the traced node_modules, but
      OpenNext's esbuild resolves under the `workerd` condition and wants
      the real file. Fixed with `outputFileTracingIncludes` pinning
      `node_modules/pg-cloudflare/{dist,esm}/**` into every route's trace.
      Verified: `npx opennextjs-cloudflare build` produces
      `.open-next/worker.js` cleanly; full `npm run verify` green.
      NOT verified here: `wrangler dev`/`deploy` from this sandbox —
      wrangler 4 requires Node ≥22, sandbox has 20.15. Cloudflare's build
      image runs Node 22+, so dashboard-driven builds are unaffected.
      Dashboard config (owner performed): build command
      `npx opennextjs-cloudflare build`, deploy command
      `npx opennextjs-cloudflare deploy`, env vars per `.env.example`
      (DATABASE_URL → Neon pooled URL, Stripe TEST keys, NEXT_PUBLIC_* at
      build time, ALLOW_LIVE=false). Migrations against Neon run manually
      (`DATABASE_URL=<neon> npm run db:migrate`) until a deploy-step
      migration job exists (08-deploy-ops pipeline).

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

- Brand assets: logo, real color palette, product photography. 2.1 shipped
  with a placeholder warm-neutral/terracotta palette (`src/app/globals.css`)
  so the layout shell could be built and tested now — swapping in the owner's
  actual palette/logo later is a one-file edit. Still needed before launch,
  and definitely before 2.6 (OG images) and 5.4 (Lighthouse/LCP image) make
  photography decisions load-bearing.
- Policy copy: shipping, returns, privacy, terms — needed for 2.8.
- Confirmation on cosmetics labeling: MoCRA requires an ingredient list and a
  responsible-person contact for body butter; candles need ASTM F2417 fire-safety
  warnings. Product data model assumes these fields exist. Needed for 1.1.
- ~~Real Shopify product CSV export: needed to actually run
  `npm run import-catalog -- <file> --apply` for the first time (1.4b).~~
  RESOLVED 2026-07-22: owner confirmed `tests/fixtures/catalog.csv` as the
  starting catalog and authorized the first `--apply`. Imported clean
  (5 products / 45 variants, zero row errors) after a `db:reset` cleared
  stale rows from an older fixture. See 1.4b's closed gate note and new
  task 1.5.

## Done

_(agent appends completed-phase summaries here)_
