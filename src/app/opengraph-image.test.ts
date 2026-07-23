// @vitest-environment node
//
// next/og's ImageResponse rasterizes via `sharp`, which chokes on jsdom's
// cross-realm Buffer/Uint8Array (fails with "Unsupported input ... of type
// object") — this file needs the plain Node environment, not the project
// default (jsdom), hence the per-file override above.
import { describe, expect, it } from "vitest";

import Image, { alt, contentType, size } from "./opengraph-image";

describe("default opengraph-image (root/non-product pages)", () => {
  it("exports standard OG dimensions, PNG content type, and non-empty alt text", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt.length).toBeGreaterThan(0);
  });

  it("renders a valid PNG image response", async () => {
    const response = Image();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
