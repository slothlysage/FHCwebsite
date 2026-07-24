"use server";

// Wires attemptLogin (4.1a) + the session service (4.1b) to real HTTP via
// Server Actions (specs/04-admin.md, task 4.1c) — same idiom as
// src/lib/actions/cart.ts: thin orchestration only, all credential/session
// logic already lives in src/lib/auth/**.
import { csrfTokensMatch } from "@/lib/auth/csrf";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";
import { attemptLogin } from "@/lib/auth/login";
import { revokeSessionByToken, rotateSession } from "@/lib/auth/session";
import {
  clearAdminSessionToken,
  readAdminSessionToken,
  writeAdminSessionToken,
} from "@/lib/auth/session-cookie";

export type AdminLoginResult =
  | { ok: true }
  | { ok: false; reason: "csrf_mismatch" | "invalid_credentials" | "locked" };

export type AdminLogoutResult =
  { ok: true } | { ok: false; reason: "csrf_mismatch" };

async function csrfOk(formData: FormData): Promise<boolean> {
  const submitted = formData.get(CSRF_FIELD_NAME);
  const cookieToken = await readCsrfCookie();
  return csrfTokensMatch(
    typeof submitted === "string" ? submitted : undefined,
    cookieToken,
  );
}

export async function loginAction(
  formData: FormData,
): Promise<AdminLoginResult> {
  if (!(await csrfOk(formData))) {
    return { ok: false, reason: "csrf_mismatch" };
  }

  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return { ok: false, reason: "invalid_credentials" };
  }

  const result = await attemptLogin(email, password);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  // Login always rotates: revoke whatever session cookie the browser
  // presented (if any — expired or not, rotateSession revokes by lookup,
  // not by validity) and issue a fresh one.
  const previousToken = await readAdminSessionToken();
  const { token } = await rotateSession(result.adminUserId, previousToken);
  await writeAdminSessionToken(token);

  return { ok: true };
}

export async function logoutAction(
  formData: FormData,
): Promise<AdminLogoutResult> {
  if (!(await csrfOk(formData))) {
    return { ok: false, reason: "csrf_mismatch" };
  }

  const token = await readAdminSessionToken();
  if (token) {
    await revokeSessionByToken(token);
  }
  await clearAdminSessionToken();

  return { ok: true };
}
