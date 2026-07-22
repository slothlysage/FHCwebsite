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
        🚦 HUMAN GATE — remains open. The AC's other clause ("importing
        the real export produces the correct product/variant counts")
        needs an actual Shopify CSV export, which this repo does not have.
        The importer and CLI are built, tested, and ready; running them
        for real against the production catalog still needs the owner to
        supply the file and confirm the parsed/diffed output before the
        first real `--apply`. See "Blocked — needs human".

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
- Real Shopify product CSV export: needed to actually run
  `npm run import-catalog -- <file> --apply` for the first time (1.4b). The
  parser, diff, apply, and CLI are all built and tested against synthetic
  data — this is purely waiting on the owner to supply the file and confirm
  the parsed/diffed product and variant counts before the first real apply.

## Done

_(agent appends completed-phase summaries here)_
