import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/client";
import { adminUsers, auditLog } from "@/lib/db/schema";
import { createAuditLogEntry } from "@/lib/repos/audit-log";

// Integration tests against a real Postgres (specs/06-testing.md). Requires
// DATABASE_URL to point at a migrated database — see AGENT.md's `db:migrate`.

describe("audit-log repo", () => {
  const insertedIds: string[] = [];
  const insertedAdminIds: string[] = [];

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await db.delete(auditLog).where(eq(auditLog.id, id));
    }
    for (const id of insertedAdminIds.splice(0)) {
      await db.delete(adminUsers).where(eq(adminUsers.id, id));
    }
  });

  it("inserts an append-only entry with before/after JSON and returns it", async () => {
    const entry = await createAuditLogEntry({
      adminUserId: null,
      action: "publish_product",
      entityType: "product",
      entityId: "00000000-0000-0000-0000-000000000000",
      before: { status: "draft" },
      after: { status: "published" },
    });
    insertedIds.push(entry.id);

    expect(entry.action).toBe("publish_product");
    expect(entry.before).toEqual({ status: "draft" });
    expect(entry.after).toEqual({ status: "published" });
    expect(entry.createdAt).toBeInstanceOf(Date);

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, entry.id));
    expect(row?.entityType).toBe("product");
  });

  it("associates an entry with the acting admin user when one is given", async () => {
    const [admin] = await db
      .insert(adminUsers)
      .values({
        email: `audit-log-test-${Date.now()}@example.com`,
        passwordHash: "not-a-real-hash",
      })
      .returning();
    insertedAdminIds.push(admin!.id);

    const entry = await createAuditLogEntry({
      adminUserId: admin!.id,
      action: "soft_delete_product",
      entityType: "product",
      entityId: "00000000-0000-0000-0000-000000000001",
      before: { deletedAt: null },
      after: { deletedAt: "2026-07-24T00:00:00.000Z" },
    });
    insertedIds.push(entry.id);

    expect(entry.adminUserId).toBe(admin!.id);
  });
});
