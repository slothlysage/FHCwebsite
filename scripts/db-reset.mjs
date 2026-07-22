// CLI entry point for `npm run db:reset`. Drops and recreates the database
// named in DATABASE_URL, then applies every migration, so local dev always
// has a known-empty schema to work against. Lives in scripts/, not src/lib/db,
// for the same reason as db-migrate.mjs — see the comment there.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to run db:reset");
}

const targetUrl = new URL(databaseUrl);
const targetDb = targetUrl.pathname.replace(/^\//, "");
if (!targetDb) {
  throw new Error(`DATABASE_URL has no database name: ${databaseUrl}`);
}

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

const adminPool = new Pool({ connectionString: adminUrl.toString() });
await adminPool.query(
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = $1 AND pid <> pg_backend_pid()`,
  [targetDb],
);
await adminPool.query(`DROP DATABASE IF EXISTS "${targetDb}"`);
await adminPool.query(`CREATE DATABASE "${targetDb}"`);
await adminPool.end();

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
await pool.end();
