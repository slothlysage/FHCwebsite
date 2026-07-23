// A minimal, in-memory fake of the Stripe API surface stripe-catalog-sync.ts
// calls, intercepted at the network boundary via msw (AGENT.md: "Mock at the
// network boundary (MSW), not by stubbing your own modules"). No stripe-mock
// binary and no recorded fixtures exist in this repo yet — msw was chosen
// over both because the Node SDK's default HTTP client uses `https.request`
// (confirmed by reading node_modules/stripe/cjs/net/NodeHttpClient.js), which
// msw's node interceptors patch the same way libraries like `nock` do, and
// because a handful of hand-written handlers cover the small, stable surface
// (products.create, prices.create, prices.retrieve, prices.update,
// checkout.sessions.create) this repo actually calls — a real stripe-mock
// binary would be one more thing to install/run in CI for five endpoints.
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

// Captured shape of a `checkout.sessions.create` call (3.3), not a full
// Stripe Session — just what `checkout.ts`'s tests need to assert against:
// the line items actually billed (resolved against the fake `prices` map,
// the same way a real Checkout Session resolves a `price` id server-side)
// plus the pass-through fields (metadata, mode, automatic_tax, shipping).
type FakeCheckoutSession = {
  id: string;
  object: "checkout.session";
  url: string;
  mode: string;
  metadata: Record<string, string>;
  automaticTaxEnabled: boolean;
  shippingAddressCollection: string[];
  shippingOptions: Array<{ displayName: string; amount: number }>;
  lineItems: Array<{ price: string; quantity: number; unitAmount: number }>;
};

let idCounter = 0;
const products = new Map<string, FakeProduct>();
const prices = new Map<string, FakePrice>();
const checkoutSessions = new Map<string, FakeCheckoutSession>();
// Idempotency-Key -> the response body first returned for that key. A real
// Stripe account keeps this for 24h; tests only need it to outlive one run.
const idempotencyResponses = new Map<
  string,
  FakeProduct | FakePrice | FakeCheckoutSession
>();

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

// Extracts every value at a fixed bracket-notation path suffixed with an
// array index — e.g. `path = "line_items[0][price]"` reads
// `line_items[0][price]`, `line_items[1][price]`, ... in index order. Stripe
// (via `qs`) encodes an array of objects as `prefix[N][field]`; this reads
// one `field` column across all `N`, which is all each call site below
// needs (a single field per line-item/shipping-option column).
function extractIndexedColumn(
  params: URLSearchParams,
  pathAtIndex: (index: number) => string,
): string[] {
  const values: string[] = [];
  for (let index = 0; params.has(pathAtIndex(index)); index += 1) {
    values.push(params.get(pathAtIndex(index))!);
  }
  return values;
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

  http.post(
    "https://api.stripe.com/v1/checkout/sessions",
    async ({ request }) => {
      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (idempotencyKey && idempotencyResponses.has(idempotencyKey)) {
        return HttpResponse.json(idempotencyResponses.get(idempotencyKey));
      }

      const params = new URLSearchParams(await request.text());
      const priceIds = extractIndexedColumn(
        params,
        (i) => `line_items[${i}][price]`,
      );
      const quantities = extractIndexedColumn(
        params,
        (i) => `line_items[${i}][quantity]`,
      );
      const lineItems = priceIds.map((priceId, index) => ({
        price: priceId,
        quantity: Number(quantities[index] ?? "0"),
        unitAmount: prices.get(priceId)?.unit_amount ?? 0,
      }));

      const shippingDisplayNames = extractIndexedColumn(
        params,
        (i) => `shipping_options[${i}][shipping_rate_data][display_name]`,
      );
      const shippingAmounts = extractIndexedColumn(
        params,
        (i) =>
          `shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`,
      );

      const id = `cs_test_${++idCounter}`;
      const session: FakeCheckoutSession = {
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.com/test/pay/${id}`,
        mode: params.get("mode") ?? "payment",
        metadata: extractMetadata(params),
        automaticTaxEnabled: params.get("automatic_tax[enabled]") === "true",
        shippingAddressCollection: extractIndexedColumn(
          params,
          (i) => `shipping_address_collection[allowed_countries][${i}]`,
        ),
        shippingOptions: shippingDisplayNames.map((displayName, index) => ({
          displayName,
          amount: Number(shippingAmounts[index] ?? "0"),
        })),
        lineItems,
      };
      checkoutSessions.set(id, session);
      if (idempotencyKey) idempotencyResponses.set(idempotencyKey, session);
      return HttpResponse.json(session);
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

export function getStripeFakeCheckoutSessions(): FakeCheckoutSession[] {
  return [...checkoutSessions.values()];
}

export function resetStripeFakeState(): void {
  products.clear();
  prices.clear();
  checkoutSessions.clear();
  idempotencyResponses.clear();
}
