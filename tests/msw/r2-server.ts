// A minimal, in-memory fake of the R2 (S3-compatible) object PUT/GET surface
// r2.ts's putObject/getObject calls, intercepted at the network boundary via
// msw (AGENT.md: "Mock at the network boundary (MSW), not by stubbing your
// own modules") — same approach as tests/msw/stripe-server.ts. A RegExp path
// is used instead of a literal host, since the account id is part of the R2
// endpoint's hostname (`https://<accountId>.r2.cloudflarestorage.com/...`).
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

type StoredObject = { body: ArrayBuffer; contentType: string };

const objects = new Map<string, StoredObject>();

const R2_HOST_PATTERN = /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\//;

function keyFromUrl(url: string): string {
  const { pathname } = new URL(url);
  // pathname is "/<bucket>/<key...>" — drop the leading "" and the bucket
  // segment, keep the rest (a key may itself contain "/").
  const [, , ...keyParts] = pathname.split("/");
  return decodeURIComponent(keyParts.join("/"));
}

export const r2Server = setupServer(
  http.put(R2_HOST_PATTERN, async ({ request }) => {
    const key = keyFromUrl(request.url);
    const body = await request.arrayBuffer();
    objects.set(key, {
      body,
      contentType: request.headers.get("content-type") ?? "",
    });
    return new HttpResponse(null, { status: 200 });
  }),

  http.get(R2_HOST_PATTERN, ({ request }) => {
    const key = keyFromUrl(request.url);
    const object = objects.get(key);
    if (!object) {
      return new HttpResponse("NoSuchKey", { status: 404 });
    }
    return new HttpResponse(object.body, {
      status: 200,
      headers: { "content-type": object.contentType },
    });
  }),
);

export function getR2FakeObject(key: string): StoredObject | undefined {
  return objects.get(key);
}

export function resetR2FakeState(): void {
  objects.clear();
}
