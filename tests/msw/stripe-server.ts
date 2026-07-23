// A minimal, in-memory fake of the Stripe API surface stripe-catalog-sync.ts
// calls, intercepted at the network boundary via msw (AGENT.md: "Mock at the
// network boundary (MSW), not by stubbing your own modules"). No stripe-mock
// binary and no recorded fixtures exist in this repo yet — msw was chosen
// over both because the Node SDK's default HTTP client uses `https.request`
// (confirmed by reading node_modules/stripe/cjs/net/NodeHttpClient.js), which
// msw's node interceptors patch the same way libraries like `nock` do, and
// because a handful of hand-written handlers cover the small, stable surface
// (products.create, prices.create, prices.retrieve, prices.update) this repo
// actually calls — a real stripe-mock binary would be one more thing to
// install/run in CI for four endpoints.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

type FakeProduct = {
  id: string;
  object: "product";
  name: string;
  active: boolean;
  metadata: Record<string, string>;
};

type FakePrice = {
  id: string;
  object: "price";
  active: boolean;
  unit_amount: number;
  currency: string;
  product: string;
  metadata: Record<string, string>;
};

let idCounter = 0;
const products = new Map<string, FakeProduct>();
const prices = new Map<string, FakePrice>();
// Idempotency-Key -> the response body first returned for that key. A real
// Stripe account keeps this for 24h; tests only need it to outlive one run.
const idempotencyResponses = new Map<string, FakeProduct | FakePrice>();

function extractMetadata(params: URLSearchParams): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match?.[1]) {
      metadata[match[1]] = value;
    }
  }
  return metadata;
}

function missingPriceResponse() {
  return HttpResponse.json(
    {
      error: {
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such price",
      },
    },
    { status: 404 },
  );
}

export const stripeServer = setupServer(
  http.post("https://api.stripe.com/v1/products", async ({ request }) => {
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey && idempotencyResponses.has(idempotencyKey)) {
      return HttpResponse.json(idempotencyResponses.get(idempotencyKey));
    }

    const params = new URLSearchParams(await request.text());
    const id = `prod_test_${++idCounter}`;
    const product: FakeProduct = {
      id,
      object: "product",
      name: params.get("name") ?? "",
      active: true,
      metadata: extractMetadata(params),
    };
    products.set(id, product);
    if (idempotencyKey) idempotencyResponses.set(idempotencyKey, product);
    return HttpResponse.json(product);
  }),

  http.post("https://api.stripe.com/v1/prices", async ({ request }) => {
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey && idempotencyResponses.has(idempotencyKey)) {
      return HttpResponse.json(idempotencyResponses.get(idempotencyKey));
    }

    const params = new URLSearchParams(await request.text());
    const id = `price_test_${++idCounter}`;
    const price: FakePrice = {
      id,
      object: "price",
      active: true,
      unit_amount: Number(params.get("unit_amount")),
      currency: params.get("currency") ?? "usd",
      product: params.get("product") ?? "",
      metadata: extractMetadata(params),
    };
    prices.set(id, price);
    if (idempotencyKey) idempotencyResponses.set(idempotencyKey, price);
    return HttpResponse.json(price);
  }),

  http.get("https://api.stripe.com/v1/prices/:id", ({ params }) => {
    const price = prices.get(params.id as string);
    if (!price) return missingPriceResponse();
    return HttpResponse.json(price);
  }),

  http.post(
    "https://api.stripe.com/v1/prices/:id",
    async ({ request, params }) => {
      const price = prices.get(params.id as string);
      if (!price) return missingPriceResponse();

      const body = new URLSearchParams(await request.text());
      if (body.has("active")) {
        price.active = body.get("active") === "true";
      }
      return HttpResponse.json(price);
    },
  ),
);

// Test-only helper: seed a pre-existing Price as if an earlier sync run
// already created it, without going through the create handler.
export function seedStripePrice(price: FakePrice): void {
  prices.set(price.id, price);
}

export function getStripeFakeProducts(): FakeProduct[] {
  return [...products.values()];
}

export function getStripeFakePrices(): FakePrice[] {
  return [...prices.values()];
}

export function resetStripeFakeState(): void {
  products.clear();
  prices.clear();
  idempotencyResponses.clear();
}
