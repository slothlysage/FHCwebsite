import { NextResponse } from "next/server";

import {
  handleStripeWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/stripe/webhook";

// Next.js App Router Route Handlers never parse the request body for you —
// unlike the old Pages Router's API routes, there is no bodyParser to
// disable. Reading `request.text()` below is already the raw body,
// untouched, which is what signature verification requires
// (specs/05-payments.md: "Raw body — Next.js must not parse it before
// signature verification").
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  await handleStripeWebhookEvent(event);

  return NextResponse.json({ received: true });
}
