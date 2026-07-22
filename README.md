# FHCwebsite

Bespoke e-commerce storefront replacing a Shopify store for a handmade candle,
body butter, and self-care products business.

This repository is built by an **autonomous agent loop** ("Ralph loop"). Humans
set direction by editing `specs/` and `fix_plan.md`; the agent does the typing.

## What's here

| Path | Purpose |
|---|---|
| `PROMPT.md` | The prompt fed to the agent on every loop iteration. Do not bloat it. |
| `AGENT.md` | House rules the agent must obey (also read by Claude Code as context). |
| `fix_plan.md` | The ordered backlog. The agent picks the top unblocked item each pass. |
| `specs/` | Source of truth for *what* to build. Agent reads these, never invents scope. |
| `loop.sh` | Driver script that runs the agent repeatedly. |
| `.github/workflows/ci.yml` | The gate. Coverage <80% = red build = not done. |

## Running the loop

```bash
# One iteration (recommended while you're still tuning specs)
./loop.sh --once

# Continuous, capped at 40 iterations
./loop.sh --max 40
```

Watch the first 3-4 iterations by hand before letting it run unattended. If the
agent starts inventing scope, the fix is almost always a vaguer-than-you-thought
spec file, not a better prompt.

## Human checkpoints

The loop **stops and asks** at these points (see `fix_plan.md` gates):

1. Before the first `stripe` API key is used (live vs test confirmation).
2. Before any DNS or production deploy step.
3. Before switching Stripe from test mode to live mode.
4. Before the product catalog import touches real customer-facing data.

## Stack

Next.js (App Router, TypeScript) · Postgres via Drizzle · Stripe Checkout ·
Cloudflare Workers hosting · Vitest + Playwright. Rationale and cost breakdown in
`specs/01-stack-and-hosting.md`.
