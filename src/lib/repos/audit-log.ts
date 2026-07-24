import { db, type DbExecutor } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

type AuditLogEntry = typeof auditLog.$inferSelect;
type NewAuditLogEntry = typeof auditLog.$inferInsert;

// Append-only (specs/02-data-model.md's audit_log entry) — no update/delete
// function exists here on purpose. specs/04-admin.md's Rules section:
// "Every mutation writes an audit_log row with before/after JSON." First
// consumer is src/lib/actions/admin-products.ts's publish/unpublish/
// soft-delete actions (4.3d).
export async function createAuditLogEntry(
  input: NewAuditLogEntry,
  executor: DbExecutor = db,
): Promise<AuditLogEntry> {
  const [entry] = await executor.insert(auditLog).values(input).returning();
  return entry!;
}
