// CLI entry point for `npm run db:migrate`. Lives in scripts/, not src/lib/db,
// alongside coverage-summary.mjs — tooling scripts outside the app source
// tree aren't part of the coverage gate (vitest.config.mts only covers
// `src/**`), and this file has no logic beyond "call drizzle's migrate() with
// our folder", which the schema integration test already exercises for real.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to run migrations");
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });

await pool.end();
