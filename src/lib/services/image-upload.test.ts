// @vitest-environment node
//
// sharp needs a real Node Buffer/typed-array realm — under this project's
// default jsdom environment it throws "Unsupported input ... of type
// object" (see specs/03-storefront.md's opengraph-image vitest gotcha for
// the same root cause). Node environment override, same as both
// opengraph-image.test.ts files.
import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  MAX_UPLOAD_BYTES,
  processUploadedImage,
} from "@/lib/services/image-upload";

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("processUploadedImage", () => {
  it("rejects a script masquerading as an image (no recognized magic bytes)", async () => {
    const fakeImage = Buffer.from("#!/bin/sh\necho pwned\n");

    const result = await processUploadedImage(fakeImage);

    expect(result).toEqual({ ok: false, error: "unrecognized_image_type" });
  });

  it("rejects a buffer over the size cap", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);

    const result = await processUploadedImage(oversized);

    expect(result).toEqual({ ok: false, error: "file_too_large" });
  });

  it("rejects bytes with a valid PNG signature but a corrupt body", async () => {
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const corrupt = Buffer.concat([
      pngSignature,
      Buffer.from("not actually a png"),
    ]);

    const result = await processUploadedImage(corrupt);

    expect(result).toEqual({ ok: false, error: "unrecognized_image_type" });
  });

  it("rejects an empty buffer", async () => {
    const result = await processUploadedImage(Buffer.alloc(0));

    expect(result).toEqual({ ok: false, error: "unrecognized_image_type" });
  });

  it("accepts a real WebP source image", async () => {
    const original = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 3,
        background: { r: 5, g: 5, b: 5 },
      },
    })
      .webp()
      .toBuffer();

    const result = await processUploadedImage(original);

    expect(result.ok).toBe(true);
  });

  it("accepts a real PNG and produces capped, non-upscaled WebP sizes", async () => {
    const original = await makePng(2000, 1000);

    const result = await processUploadedImage(original);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sizes.map((size) => size.label)).toEqual([
      "thumbnail",
      "medium",
      "large",
    ]);
    for (const size of result.sizes) {
      expect(size.contentType).toBe("image/webp");
      expect(size.width).toBeLessThanOrEqual(1600);
    }

    const large = result.sizes.find((size) => size.label === "large");
    expect(large?.width).toBe(1600);
    expect(large?.height).toBe(800);
  });

  it("does not upscale an image smaller than a responsive target", async () => {
    const original = await makePng(300, 200);

    const result = await processUploadedImage(original);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const size of result.sizes) {
      expect(size.width).toBeLessThanOrEqual(300);
      expect(size.height).toBeLessThanOrEqual(200);
    }
    const widths = new Set(result.sizes.map((size) => size.width));
    expect(widths.size).toBe(1);
  });

  it("auto-orients from EXIF and then strips all metadata", async () => {
    // 800x400 landscape, tagged EXIF orientation 6 (rotate 90 CW) — the
    // true visual orientation is portrait 400x800.
    const rotated = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: { r: 10, g: 200, b: 10 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await processUploadedImage(rotated);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const large = result.sizes.find((size) => size.label === "large");
    expect(large).toBeDefined();
    expect(large!.width).toBeLessThan(large!.height);

    const metadata = await sharp(large!.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
});
