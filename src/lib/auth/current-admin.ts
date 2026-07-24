import { verifySession } from "@/lib/auth/session";
import { readAdminSessionToken } from "@/lib/auth/session-cookie";

// Resolves the acting admin for audit-log attribution (specs/04-admin.md's
// "every mutation writes an audit_log row with before/after JSON") — first
// consumer is src/lib/actions/admin-products.ts's publish/unpublish/
// soft-delete actions (4.3d). Only valid to call from within a Server
// Action/Route Handler request context (readAdminSessionToken's own
// constraint). Returns undefined rather than throwing on a missing/invalid
// cookie — `audit_log.admin_user_id` is nullable, and losing attribution
// should never block the mutation itself; a route reaching here has already
// passed proxy.ts's session check (4.2) in practice.
export async function getCurrentAdminUserId(): Promise<string | undefined> {
  const token = await readAdminSessionToken();
  if (!token) {
    return undefined;
  }
  const result = await verifySession(token);
  return result.valid ? result.session.adminUserId : undefined;
}
