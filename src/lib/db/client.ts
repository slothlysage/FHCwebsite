import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

// Either the module-level singleton or a `db.transaction` callback's `tx`.
// Repo functions accept this (defaulting to `db`) so a caller that needs
// several repo calls to commit or roll back together — e.g. the catalog
// importer's multi-table write — can thread one `tx` through all of them.
export type DbExecutor =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
