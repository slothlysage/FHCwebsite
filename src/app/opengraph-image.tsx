import fs from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

// Applies to every route by default (Next's file-convention: a segment
// inherits the nearest ancestor's opengraph-image unless it defines its own
// — see products/[slug]/opengraph-image.tsx for the one override). This is
// the "static default for non-product pages" half of fix_plan 2.6d.
//
// No product photography yet (still on fix_plan's "Blocked" list), but the
// real logo mark shipped 2026-07-23 — read from disk and inlined as a data
// URI since satori (next/og's renderer) needs literal <img src> data, not a
// build-relative import. The brand palette (src/app/globals.css) is
// hardcoded here rather than imported for the same reason: this file renders
// outside Tailwind's CSS pipeline, which needs literal style values.
export const alt =
  "Fasthorse Creations — handmade candles, body butter, and self-care products";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#f8f5ee";
const INK = "#2e2b26";
const LAVENDER = "#6a5a90";

const markDataUri = `data:image/png;base64,${fs
  .readFileSync(path.join(process.cwd(), "public/brand/fc-mark.png"))
  .toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: CREAM,
      }}
    >
      {/* satori (next/og) renders its own <img>, not next/image */}
      <img src={markDataUri} width={160} height={160} alt="" />
      <div
        style={{
          display: "flex",
          marginTop: 20,
          fontSize: 76,
          fontWeight: 600,
          color: INK,
        }}
      >
        Fasthorse Creations
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 20,
          fontSize: 36,
          color: LAVENDER,
        }}
      >
        Handmade candles, body butter &amp; self-care
      </div>
    </div>,
    { ...size },
  );
}
