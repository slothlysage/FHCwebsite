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

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
});
