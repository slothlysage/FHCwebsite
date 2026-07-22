# 01 — Stack and hosting

## Decisions

| Concern   | Choice                                        | Why                                                |
| --------- | --------------------------------------------- | -------------------------------------------------- |
| Framework | Next.js App Router + TS                       | Server rendering for SEO; one deployable           |
| DB        | Postgres on Neon                              | Free tier, real SQL, branching for staging         |
| ORM       | Drizzle                                       | Typed, thin, migrations are plain SQL you can read |
| Payments  | Stripe Checkout (hosted)                      | Keeps card data off our servers entirely           |
| Hosting   | Cloudflare Workers (`@opennextjs/cloudflare`) | Generous free tier, **commercial use permitted**   |
| Files     | Cloudflare R2                                 | No egress fees                                     |
| Email     | Resend                                        | 3k/month free, good DX                             |
| Analytics | Plausible or self-hosted Umami                | Cookieless — no consent banner                     |
| Errors    | Sentry                                        | Free tier sufficient                               |

## On "free hosting" — read this before choosing

Vercel is the obvious default for Next.js, but **the Hobby (free) tier forbids
commercial use**. A store selling products is commercial. Deploying there means
either paying $20/month for Pro or operating against the terms. That's why the
recommendation above is Cloudflare, whose free tier has no such restriction.

Realistic monthly cost at low volume:

- Cloudflare Workers: $0 (paid plan $5/mo if you exceed free request limits)
- Neon Postgres: $0 on free tier — but note it **suspends idle databases**,
  which adds cold-start latency. $19/mo removes that if it becomes annoying.
- R2: $0 for a few hundred product images
- Resend: $0
- Domain: already owned
- **Stripe: 2.9% + $0.30 per transaction.** This is the real cost and it is
  unavoidable regardless of host.

Expected: **$0–5/month** plus Stripe fees.

If cold starts on the free Neon tier prove unacceptable, the cheapest fix is a
$5/mo Postgres on Railway or Fly, not a bigger web host.

## Scaffolding notes (0.1)

- `npx create-next-app@latest .` refuses to run because `create-next-app`
  rejects package names with capital letters, and it derives the name from the
  target directory (`FHCwebsite`). Workaround: scaffold into a throwaway temp
  directory with a lowercase name, then copy the generated files in and fix
  `package.json`'s `name` field by hand. Don't rename the repo directory to
  work around this.
- Scaffolded with Next.js 16.2.11 / React 19.2.4 / Tailwind 4 (`@tailwindcss/postcss`,
  no `tailwind.config.*` file — v4 configures via `@theme` in `globals.css`).
- `next build` type-checks every `.ts`/`.tsx` file reachable from
  `tsconfig.json`'s `include`, not just app code. `vitest.config.ts` (added
  ahead of schedule by task 0.2's prep work) broke the build until `vitest`
  was an installed dependency, so it and `tests/` were temporarily listed in
  `tsconfig.json`'s `exclude`. Both entries were removed once 0.2 installed
  vitest — see "Scaffolding notes (0.2)" below.

## Scaffolding notes (0.2)

Installing the test harness (Vitest + RTL + jsdom) on this sandbox
(Node 20.15.0, npm 10.7.0) hit three unrelated install/loader bugs, not
anything specific to this repo. If a fresh clone fails the same way, this is
why:

- `npm install` silently failed to fetch the platform-specific optional dep
  `@rolldown/binding-linux-x64-gnu` that `vite@8`'s (a `vitest` dependency)
  hard `rolldown` dependency needs at runtime — a known npm optional-deps
  bug. Symptom: `vitest run` fails at startup with "Cannot find native
  binding". Fix: `npm install --no-save @rolldown/binding-linux-x64-gnu@1.1.5`
  (swap the platform suffix if not linux-x64-gnu).
- `package.json` has no `"type": "module"` (Next.js apps typically don't),
  so Vite loads `vitest.config.ts` via CJS `require()`, which broke on an
  ESM-only transitive dep (`std-env`). Fixed by naming the config
  `vitest.config.mts` instead — the `.mts` extension forces ESM loading
  regardless of `package.json`'s `type`, without touching Next's own build.
- `jsdom@29.x`'s dependency `html-encoding-sniffer@6` is ESM-only
  (`@exodus/bytes`) and breaks under vitest's CJS worker `require()`. Pinned
  `jsdom` to `26.1.0` (last line depending on `html-encoding-sniffer ^4.0.0`,
  which is CJS). Revisit this pin periodically — it's a workaround, not a
  permanent constraint.

## Scaffolding notes (0.4)

`src/lib/env.ts` validates `process.env` with two separate zod schemas rather
than one:

- `serverSchema` — DB, Stripe secret key, `ALLOW_LIVE`, admin bootstrap, R2,
  Resend, Sentry. Vars for features not built yet are `.optional()`; promote
  each to required only in the iteration that actually wires up that feature,
  so an unused var never fails `npm run build` for no reason.
- `clientSchema` — the `NEXT_PUBLIC_*` vars, always required.

`clientEnv` is built from **literal** `process.env.NEXT_PUBLIC_X` reads, one
per key, not a spread of the whole `process.env` object. Next's
build only inlines a specific literal `process.env.SOME_VAR` member
expression into the client bundle — a dynamic/generic `process.env` lookup
is `undefined` in the browser regardless of what's set on the server. This
is the same constraint that shapes libraries like `t3-env`.

There's no explicit "validate at boot" call — the root layout imports `env`
and uses `NEXT_PUBLIC_SITE_URL` for `metadata.metadataBase`, and because the
root layout is on every route, that import runs during `next build`'s page
data collection, which is what makes a missing var fail the build. If a
future page stops needing `env` at that layer, the validation needs a new
forced import site (or an explicit call in `instrumentation.ts`) or it'll
silently stop running at build time.

## Alternative if the agent struggles with the Cloudflare adapter

`@opennextjs/cloudflare` is less mature than Vercel's first-party path and some
Node APIs are unavailable. If it becomes a repeated blocker, deploying the same
codebase to Netlify or a $5 Fly.io VM is an acceptable fallback — record the
decision here if you switch. Do not switch silently.
