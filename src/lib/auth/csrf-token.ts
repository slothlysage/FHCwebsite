// CSRF cookie name/field name + token generation — kept separate from
// csrf.ts's csrfTokensMatch() specifically because src/proxy.ts (task 4.1c)
// imports generateCsrfToken(), and proxy/middleware files run in Next's
// Edge Runtime by default: `next build` flags any file in that import graph
// that touches `node:crypto` (confirmed via a real build — csrfTokensMatch's
// `timingSafeEqual` import triggered exactly this warning when it lived in
// the same file). Web Crypto's `crypto.getRandomValues` + `btoa` are
// standard APIs available in the Edge Runtime, Node, and Cloudflare
// Workers alike, so this file is safe for proxy.ts to import directly.
export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_FIELD_NAME = "csrfToken";

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
