import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import {
  drizzle as drizzleNodePg,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

// Cloudflare Workers can't hold TCP sockets across requests, so the pg Pool
// singleton below would fail there with "Cannot perform I/O on behalf of a
// different request". On Workers we use Neon's serverless driver over HTTP
// instead — each query is a stateless fetch, safe in a module-scope
// singleton. workerd identifies itself via navigator.userAgent; Node 20 has
// no navigator and jsdom's is a browser string, so both fall through to pg.
//
// CAVEAT for phase 3 (checkout): the neon-http driver does not support
// interactive `db.transaction`. Today every DB path that runs on Workers is
// read-only (listing/detail); the transactional writers (catalog importer
// CLI, order creation) run under node-postgres locally/in tests. When order
// creation moves into the deployed app, switch its path to a per-request
// WebSocket Pool from @neondatabase/serverless (which does support
// transactions) — see https://neon.com/docs/connect/choose-connection.
const isCloudflareWorkers =
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";

function createDb(): NodePgDatabase<typeof schema> {
  if (isCloudflareWorkers) {
    // Cast: NeonHttpDatabase and NodePgDatabase share the same query-builder
    // API surface the repos use; they differ only in session/transaction
    // internals (see CAVEAT above). Typing `db` as the node-postgres shape
    // keeps DbExecutor and every repo signature unchanged.
    return drizzleNeonHttp(neon(env.DATABASE_URL), {
      schema,
    }) as unknown as NodePgDatabase<typeof schema>;
  }
  return drizzleNodePg(new Pool({ connectionString: env.DATABASE_URL }), {
    schema,
  });
}

export const db = createDb();

// Either the module-level singleton or a `db.transaction` callback's `tx`.
// Repo functions accept this (defaulting to `db`) so a caller that needs
// several repo calls to commit or roll back together — e.g. the catalog
// importer's multi-table write — can thread one `tx` through all of them.
export type DbExecutor =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
