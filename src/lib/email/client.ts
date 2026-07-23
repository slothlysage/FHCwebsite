import { Resend } from "resend";

import { env } from "@/lib/env";

// Resend's SDK reads `fetch` as a bare global at request time, not a
// reference captured at construction (confirmed by reading
// node_modules/resend/dist/index.mjs) — unlike the Stripe client
// (src/lib/stripe/client.ts), a msw-intercepted test can import this
// singleton statically with no dynamic-import-after-listen workaround.
export const resend = new Resend(env.RESEND_API_KEY);
