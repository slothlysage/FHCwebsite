import { defineConfig } from "drizzle-kit";

// Loaded directly from process.env, not `src/lib/env.ts` — drizzle-kit runs
// as a standalone CLI outside Next's build, and importing the full zod-parsed
// env here would require every other var (Stripe, etc.) to be set just to
// generate a migration.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to run drizzle-kit");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
});
