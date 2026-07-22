# 06 — Testing strategy

## The 80% requirement, honestly

80% coverage is a floor that catches negligence, not a proof of correctness. A
suite can hit 90% and still miss that prices are read from the client. So the
thresholds are configured as a *gate*, and the spec below says *what* must be
tested, which matters more than the number.

Configured thresholds (`vitest.config.ts`, and the agent may not lower them):

| Scope | lines / statements / branches / functions |
|---|---|
| global | 80% |
| `src/lib/services/**` | 90% |
| `src/lib/stripe/**` | 90% |
| `src/lib/auth/**` | 90% |

Excluded from coverage: generated Drizzle types, `*.config.*`, `src/app/**/layout.tsx`,
test fixtures. Nothing else. Adding an exclusion to make a number go up is
explicitly forbidden by `AGENT.md`.

## Pyramid

**Unit (most)** — services, validation schemas, price and total calculation,
filter query building, status state machines, discount rules. Pure functions
wherever possible. Fast, no database.

**Integration** — repositories against a real Postgres (docker), route handlers
with a test database, webhook handlers with signed payloads. Each test runs in a
transaction that is rolled back.

**Component** — RTL. Assert behavior and accessible output, not implementation.
Query by role and label, never by test id unless there is no alternative.

**E2E (fewest)** — Playwright, real browser, test-mode Stripe. Covers the paths
where money moves.

## Must-have test cases

Non-negotiable. These are the ones that catch the expensive bugs.

1. Checkout ignores a client-supplied price
2. Replayed webhook creates exactly one order
3. Webhook with a bad signature returns 400 and writes nothing
4. Order creation rolls back completely on partial failure
5. Two concurrent checkouts for one remaining unit don't both succeed
6. Unpublished products are absent from listing HTML
7. Every `/admin/**` route rejects an unauthenticated request (enumerated, so a
   new unguarded route fails the suite)
8. Login is rate-limited and locks out
9. Session cookie is `httpOnly` + `Secure` + `SameSite`
10. Filter combinations return the correct set (each facet alone, two combined,
    empty result)
11. Pagination is stable across a non-unique sort key
12. Stock displayed always equals the sum of inventory movements
13. Sentry payloads contain no email, address, or card data
14. Cart reflects a price change made after the item was added

## Discipline

- Write the test first and watch it fail. A test that has never failed proves
  nothing.
- One behavior per test. The name says the behavior: `rejects checkout when a
  variant is inactive`, not `test checkout 3`.
- No shared mutable state between tests. Each seeds what it needs.
- Every bug fix ships with a regression test that fails without the fix.
- Flaky tests are bugs. Quarantining is not fixing; fix or delete with a note.
