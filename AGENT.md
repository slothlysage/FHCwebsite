# AGENT.md — house rules

## Stack (do not substitute without a spec change)

- Next.js App Router, TypeScript `strict: true`, React Server Components by default
- Drizzle ORM + PostgreSQL (Neon)
- Stripe Checkout (hosted) + webhooks. **Not** Payment Element in v1.
- Tailwind CSS. No component library; hand-rolled primitives in `src/components/ui`.
- Vitest + React Testing Library (unit/integration), Playwright (E2E)
- Zod for every external boundary: env vars, form input, API payloads, webhook bodies

## Layout

```
src/
  app/                  routes only — thin, no business logic
    (storefront)/
    admin/
    api/
  lib/
    db/                 schema.ts, client.ts, migrations/
    repos/              data access. ONLY layer that imports db.
    services/           business logic. Pure where possible. Heaviest test target.
    stripe/             Stripe client + webhook handlers
    validation/         zod schemas, shared client+server
  components/
tests/
  e2e/                  Playwright
  fixtures/
```

Dependency direction is one-way: `app → services → repos → db`. A route handler
that imports `db` directly is a review failure.

## Testing rules

- TDD. Red, green, refactor. The commit should contain the test and the code.
- Coverage thresholds are in `vitest.config.ts` and are a floor, not a target.
  Global 80% lines/statements/branches/functions. `src/lib/services/**` and
  `src/lib/stripe/**` are held to 90% — money and correctness live there.
- Do not chase coverage with tests that assert nothing. A test that renders a
  component and asserts `toBeTruthy()` is worse than no test.
- Mock at the network boundary (MSW), not by stubbing your own modules.
- Stripe: use `stripe-mock` or recorded fixtures for unit tests; use the Stripe
  CLI (`stripe listen --forward-to`) for webhook E2E. Never hit live Stripe.
- Every bug fixed gets a regression test that fails without the fix.

## Money

- Store money as **integer minor units** (cents), never floats. Column type
  `integer`. A `price: number` that could hold `19.99` is a bug.
- The server recomputes every line total and the order total from the database
  at checkout time. Client-supplied prices are ignored, not validated.
- Stripe is the source of truth for _payment status_. The database is the source
  of truth for _catalog and inventory_.

## Commits

Conventional commits: `feat|fix|test|chore|docs|refactor(scope): summary`.
One task per commit. Body explains _why_ if non-obvious.

## Style

- No `any`. No `@ts-ignore` without a comment naming the upstream issue.
- Server Components by default; `"use client"` only where interactivity requires it.
- Accessibility is not a phase. Every interactive component ships with keyboard
  support and an accessible name, and is covered by an axe assertion.
