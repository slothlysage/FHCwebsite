# 01 — Stack and hosting

## Decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js App Router + TS | Server rendering for SEO; one deployable |
| DB | Postgres on Neon | Free tier, real SQL, branching for staging |
| ORM | Drizzle | Typed, thin, migrations are plain SQL you can read |
| Payments | Stripe Checkout (hosted) | Keeps card data off our servers entirely |
| Hosting | Cloudflare Workers (`@opennextjs/cloudflare`) | Generous free tier, **commercial use permitted** |
| Files | Cloudflare R2 | No egress fees |
| Email | Resend | 3k/month free, good DX |
| Analytics | Plausible or self-hosted Umami | Cookieless — no consent banner |
| Errors | Sentry | Free tier sufficient |

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
  ahead of schedule by task 0.2's prep work) breaks the build until `vitest`
  is an installed dependency, so it and `tests/` are temporarily listed in
  `tsconfig.json`'s `exclude`. Remove both exclude entries once 0.2 installs
  vitest.

## Alternative if the agent struggles with the Cloudflare adapter

`@opennextjs/cloudflare` is less mature than Vercel's first-party path and some
Node APIs are unavailable. If it becomes a repeated blocker, deploying the same
codebase to Netlify or a $5 Fly.io VM is an acceptable fallback — record the
decision here if you switch. Do not switch silently.
