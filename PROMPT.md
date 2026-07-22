# Ralph loop prompt — FHCwebsite

You are working on FHCwebsite, a bespoke e-commerce storefront. You are one
iteration in a long loop. You have no memory of previous iterations. Everything
you need to know is in this repository.

## Do this, in order

1. Read `AGENT.md`. It is binding.
2. Read `fix_plan.md`. Read every file in `specs/` that the top items reference.
3. Run `git log --oneline -15` to see what recent iterations actually did.
4. Pick **exactly ONE** task: the highest item in `fix_plan.md` that is not
   `[x]` and whose listed dependencies are all `[x]`.
5. Before writing any new file, search the repo for an existing implementation:
   `rg -i "<the-thing>" --type ts --type tsx`. Duplicate parallel
   implementations are the single most common failure mode of this loop. If you
   find one, extend it instead of creating a sibling.
6. Write the failing test first. Run it. Confirm it fails for the right reason.
7. Implement the minimum that makes it pass.
8. Run the full gate: `npm run verify` (lint, typecheck, test with coverage,
   build). It must pass. If coverage dropped below threshold, you are not done.
9. Update `fix_plan.md`: tick your task `[x]`, and append anything you
   discovered that needs doing to the correct phase. Keep it ordered.
10. If you learned something structural (an API shape, a gotcha, a decision),
    write it into the relevant `specs/` file. Specs are the loop's memory.
11. Commit: `git add -A && git commit -m "<type>(<scope>): <what>"`.
12. Stop. Do not start a second task.

## Hard rules

- **One task per iteration.** If the task turns out to be three tasks, split it
  in `fix_plan.md`, do the first, and stop.
- **Never weaken a test to make it pass.** Never delete a test, never add
  `.skip`, never lower a coverage threshold, never add a file to coverage
  exclusions. If a test is genuinely wrong, fix the test *and* explain why in
  the commit body.
- **Never commit a secret.** Keys live in `.env.local` and in the host's secret
  store. `.env.example` gets the key *name* only.
- **Never touch Stripe live mode.** Test mode keys only (`sk_test_*`,
  `pk_test_*`). Any task requiring live keys is a HUMAN GATE — stop and say so.
- **Never run a destructive DB command** against anything but the local dev
  database.
- **Prices are computed server-side.** Any code path that takes a price, total,
  or quantity from the client and sends it to Stripe is a bug, even if tests pass.
- If you are blocked or the spec is ambiguous, do not guess. Write the question
  into `fix_plan.md` under `## Blocked — needs human` and commit that. That is a
  valid, complete iteration.

## When the plan is empty

If every item in `fix_plan.md` is `[x]`, do not invent work. Run `npm run verify`,
write a short status summary to `fix_plan.md` under `## Done`, commit, and stop.
