import { cookies } from "next/headers";

export const CART_COOKIE_NAME = "cart_id";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Read-only — safe to call from Server Components (which render more often
// than they mutate) as well as Server Actions. Returns undefined for a
// first-time visitor; callers decide whether "no cart yet" means "empty
// cart" (Server Components) or "create one" (Server Actions).
export async function readCartId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value;
}

// Mutates the response's Set-Cookie header — only valid when called from a
// Server Action or Route Handler. Next throws at runtime (not in the type
// system) if this runs during a plain Server Component render.
export async function writeCartId(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, cartId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
