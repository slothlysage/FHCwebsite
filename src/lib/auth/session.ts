// Session token lifecycle (specs/04-admin.md's Auth section, task 4.1b).
// Cookie writing, CSRF, and login/logout HTTP routes are a separate concern
// (4.1c) — this module only issues/verifies/revokes session records.
import { randomBytes, createHash } from "node:crypto";

import {
  createSession,
  getSessionByTokenHash,
  revokeSession,
} from "@/lib/repos/sessions";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

type Session = Awaited<ReturnType<typeof createSession>>;

export type VerifySessionResult =
  | { valid: true; session: Session }
  | { valid: false; reason: "not_found" | "revoked" | "expired" };

function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(
  adminUserId: string,
  options?: { expiresAt?: Date; ip?: string; userAgent?: string },
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const session = await createSession({
    adminUserId,
    tokenHash: hashSessionToken(token),
    expiresAt: options?.expiresAt ?? new Date(Date.now() + SESSION_DURATION_MS),
    ip: options?.ip,
    userAgent: options?.userAgent,
  });
  return { token, session };
}

export async function verifySession(
  token: string,
): Promise<VerifySessionResult> {
  const session = await getSessionByTokenHash(hashSessionToken(token));

  if (!session) {
    return { valid: false, reason: "not_found" };
  }
  if (session.revokedAt) {
    return { valid: false, reason: "revoked" };
  }
  if (session.expiresAt <= new Date()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, session };
}

// Login always rotates: revoke the previous session (if the caller had one)
// and issue a fresh one, rather than reusing a token across logins.
export async function rotateSession(
  adminUserId: string,
  previousToken: string | undefined,
  options?: { ip?: string; userAgent?: string },
): Promise<{ token: string; session: Session }> {
  if (previousToken) {
    await revokeSessionByToken(previousToken);
  }
  return issueSession(adminUserId, options);
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const session = await getSessionByTokenHash(hashSessionToken(token));
  if (session && !session.revokedAt) {
    await revokeSession(session.id, new Date());
  }
}
