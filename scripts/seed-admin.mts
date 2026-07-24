// CLI entry point for `npm run seed-admin`. Creates the single real
// `admin_users` row (specs/04-admin.md: "The account is created by a seed
// script") from ADMIN_EMAIL/ADMIN_INITIAL_PASSWORD (.env.example). Idempotent
// — a second run against an already-seeded email is a no-op, not an error,
// same convention as db-migrate.mjs/db-reset.mjs being safe to re-run.
// Reuses hashPassword/createAdminUser (4.1a) rather than reimplementing
// hashing here — same "don't duplicate already-tested logic" rule
// import-catalog.mts's own header note gives for its CLI wrapper.
import { hashPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { createAdminUser, getAdminUserByEmail } from "@/lib/repos/admin-users";

async function main(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_INITIAL_PASSWORD) {
    console.error(
      "ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD must both be set in .env.local to seed the admin user.",
    );
    process.exitCode = 1;
    return;
  }

  const existing = await getAdminUserByEmail(env.ADMIN_EMAIL);
  if (existing) {
    console.log(`Admin user ${env.ADMIN_EMAIL} already exists — nothing to do.`);
    return;
  }

  const passwordHash = await hashPassword(env.ADMIN_INITIAL_PASSWORD);
  await createAdminUser({ email: env.ADMIN_EMAIL, passwordHash });
  console.log(`Created admin user ${env.ADMIN_EMAIL}.`);
}

await main();
