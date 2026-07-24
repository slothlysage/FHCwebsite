import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";

// Read-only — the cookie itself is written by src/proxy.ts (it runs
// before any Server Component/Action and can set cookies unconditionally;
// Server Actions can only append Set-Cookie to their own response, which is
// too late for the *first* render of a form needing the token). Server
// Actions only ever need to read it back for comparison against the
// submitted form field.
export async function readCsrfCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(CSRF_COOKIE_NAME)?.value;
}
