import { ImageResponse } from "next/og";

// Applies to every route by default (Next's file-convention: a segment
// inherits the nearest ancestor's opengraph-image unless it defines its own
// — see products/[slug]/opengraph-image.tsx for the one override). This is
// the "static default for non-product pages" half of fix_plan 2.6d.
//
// Deliberately text-only, no photography — per fix_plan's "Blocked" list,
// real product/brand photography doesn't exist yet. The brand palette
// (src/app/globals.css) is hardcoded here rather than imported, since this
// file renders outside Tailwind's CSS pipeline (satori needs literal style
// values, not utility classes).
export const alt =
  "FHC — handmade candles, body butter, and self-care products";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#faf6f0";
const INK = "#2b2420";
const CLAY = "#c1694f";

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
      <div
        style={{ display: "flex", fontSize: 120, fontWeight: 600, color: INK }}
      >
        FHC
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 28,
          fontSize: 36,
          color: CLAY,
        }}
      >
        Handmade candles, body butter &amp; self-care
      </div>
    </div>,
    { ...size },
  );
}
