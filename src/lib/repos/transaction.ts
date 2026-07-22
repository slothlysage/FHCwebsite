import { db, type DbExecutor } from "@/lib/db/client";

// The only place outside `db/client.ts` that touches `db.transaction`
// directly. Services need a transaction boundary around several repo calls
// (see `services/catalog-import.ts`) but AGENT.md reserves importing `db`
// itself to `repos/` — so the boundary lives here and callers get back a
// `DbExecutor` to thread through ordinary repo functions.
export function withTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
