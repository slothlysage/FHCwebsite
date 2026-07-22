# 08 — Deployment and operations

## Environments

|            | Database        | Stripe   | Domain           |
| ---------- | --------------- | -------- | ---------------- |
| local      | docker Postgres | test     | localhost:3000   |
| staging    | Neon branch     | test     | staging.<domain> |
| production | Neon main       | **live** | <domain>         |

Production secrets exist only in the Cloudflare dashboard. Nobody's laptop has
live Stripe keys.

## Pipeline

PR → CI (`npm run verify` + Playwright + Lighthouse) → merge to `main` →
auto-deploy to staging → manual promote to production.

Migrations run as a separate step before the app deploy, and must be
backwards-compatible with the currently-running version (expand/contract): add
columns nullable first, backfill, then tighten in a later release. Never a
destructive migration in the same deploy as the code that needs it.

## Backups

- Neon point-in-time recovery on the paid tier; on free tier, a nightly
  `pg_dump` to R2 via a scheduled Worker, 30-day retention.
- **A backup you have never restored is not a backup.** Do a restore drill
  before launch and write the exact working steps here.

## Monitoring

- Sentry for errors, alerting the owner's email on anything in the checkout or
  webhook path.
- Uptime check every 5 minutes against `/api/health` (which checks database
  connectivity, not just that the process is alive).
- A daily digest: orders received vs orders with a matching webhook. A mismatch
  is the single most important signal this system can produce.
- Stripe dashboard alerts for failed webhook deliveries.

## Runbook topics (`docs/RUNBOOK.md`, written at task 6.7)

- Add / edit / unpublish a product
- Process an order, print a packing slip, mark shipped
- Issue a full or partial refund
- "A customer says they paid but has no confirmation" — how to check Stripe,
  find the event, and replay the webhook
- "The site is down" — check Cloudflare status, Neon status, recent deploys,
  how to roll back
- Rotate a leaked key
- Restore from backup

The runbook is for a person who is stressed and not a developer. Write it that
way: numbered steps, exact button names, no jargon.
