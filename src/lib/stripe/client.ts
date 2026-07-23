import Stripe from "stripe";

import { env } from "@/lib/env";

// Pinned, not left to float to the account's default/dashboard-configured
// version — an unannounced Stripe API upgrade must never change our request/
// response shapes out from under us. Bump deliberately, matching the
// installed `stripe` SDK's own compiled default (see node_modules/stripe/
// cjs/apiVersion.d.ts) so request and response typings stay in sync.
export const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

function assertNotLiveModeUnlessAllowed(
  secretKey: string,
  allowLive: boolean,
): void {
  if (secretKey.startsWith("sk_live_") && !allowLive) {
    throw new Error(
      "Refusing to initialize Stripe with a live secret key (sk_live_*). " +
        "Set ALLOW_LIVE=true to override this safety interlock — see " +
        "AGENT.md's 'Never touch Stripe live mode' rule.",
    );
  }
}

assertNotLiveModeUnlessAllowed(env.STRIPE_SECRET_KEY, env.ALLOW_LIVE);

// Explicit fetch-based HTTP client, not the SDK's Node default. Two reasons:
// 1. Cloudflare Workers (this project's deploy target, task 6.0) has no
//    `http`/`https` modules — `fetch` is the only thing that works there.
//    The package.json "workerd" export condition would technically pick a
//    fetch-capable build automatically, but this makes it explicit rather
//    than relying on the right condition being resolved at bundle time.
// 2. The Node default (`NodeHttpClient`) defers writing the request body
//    until a `'socket'` event fires with `secureConnect`, which msw's Node
//    `http.ClientRequest` interceptor never emits — every request hangs
//    until timeout under `stripe-mock`-free, msw-based unit tests (3.2b).
//    `fetch` interception is msw's primary, well-supported path with no such
//    gap. See tests/msw/stripe-server.ts for the mocking approach this unlocks.
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
});
