"use server";

// Wires attemptLogin (4.1a) + the session service (4.1b) to real HTTP via
// Server Actions (specs/04-admin.md, task 4.1c) — same idiom as
// src/lib/actions/cart.ts: thin orchestration only, all credential/session
// logic already lives in src/lib/auth/**.
import { redirect } from "next/navigation";

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

export type AdminLogoutResult =
  { ok: true } | { ok: false; reason: "csrf_mismatch" };

const LOGIN_PATH = "/admin/login";
const ADMIN_HOME_PATH = "/admin";

async function csrfOk(formData: FormData): Promise<boolean> {
  const submitted = formData.get(CSRF_FIELD_NAME);
  const cookieToken = await readCsrfCookie();
  return csrfTokensMatch(
    typeof submitted === "string" ? submitted : undefined,
    cookieToken,
  );
}

// Redirects rather than returning a result object — same progressive-
// enhancement convention as applyDiscountCodeAction/
// createCheckoutSessionAction (src/lib/actions/cart.ts, checkout.ts): a
// plain <form action={loginAction}> works with no client JS only if the
// action itself drives navigation. The error reason travels as a query
// param the login page maps to copy, never leaking *which* of "no such
// user"/"wrong password" applies (both collapse to attemptLogin's single
// "invalid_credentials" reason).
export async function loginAction(formData: FormData): Promise<void> {
  if (!(await csrfOk(formData))) {
    redirect(`${LOGIN_PATH}?error=csrf_mismatch`);
  }

  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    redirect(`${LOGIN_PATH}?error=invalid_credentials`);
  }

  const result = await attemptLogin(email, password);
  if (!result.ok) {
    redirect(`${LOGIN_PATH}?error=${result.reason}`);
  }

  // Login always rotates: revoke whatever session cookie the browser
  // presented (if any — expired or not, rotateSession revokes by lookup,
  // not by validity) and issue a fresh one.
  const previousToken = await readAdminSessionToken();
  const { token } = await rotateSession(result.adminUserId, previousToken);
  await writeAdminSessionToken(token);

  redirect(ADMIN_HOME_PATH);
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
