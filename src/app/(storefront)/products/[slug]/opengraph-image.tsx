import fs from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { formatPriceCents } from "@/lib/format";
import { getProductDetail } from "@/lib/services/product-detail";

// Dynamic per-product OG image (fix_plan 2.6d) — this file's route
// (/products/[slug]/opengraph-image) is resolved into the page's metadata
// automatically by Next's file convention, overriding the site-wide default
// at src/app/opengraph-image.tsx for exactly this segment.
//
// No product photo yet: per fix_plan.md's "Blocked" list, real product
// photography doesn't exist, and product_images.url values from the CSV
// importer aren't guaranteed to be reachable/right-sized for satori to
// fetch. Swap in a real photo once that asset exists. The logo mark shipped
// 2026-07-23 and is inlined as a data URI (same rationale as the site-wide
// default at src/app/opengraph-image.tsx).
export const alt = "Product photo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#f8f5ee";
const INK = "#2e2b26";
const LAVENDER = "#6a5a90";

const markDataUri = `data:image/png;base64,${fs
  .readFileSync(path.join(process.cwd(), "public/brand/fc-mark.png"))
  .toString("base64")}`;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getProductDetail(slug);

  // Unknown/draft/archived/soft-deleted slugs (getProductDetail returns
  // null for all of them, same "don't leak an unpublished product" contract
  // as the page itself — see product-detail.ts) fall back to a generic
  // card rather than throwing, which would otherwise surface as a broken
  // image to a crawler or a stale shared link.
  const name = detail?.name ?? "Handmade goods";
  const priceFromCents =
    detail && detail.variants.length > 0
      ? Math.min(...detail.variants.map((variant) => variant.priceCents))
      : null;

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
        padding: 80,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* satori (next/og) renders its own <img>, not next/image */}
        <img src={markDataUri} width={48} height={48} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: LAVENDER,
          }}
        >
          Fasthorse Creations
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 32,
          fontSize: 72,
          fontWeight: 600,
          color: INK,
        }}
      >
        {name}
      </div>
      {priceFromCents !== null && (
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 40,
            color: INK,
          }}
        >
          from {formatPriceCents(priceFromCents)}
        </div>
      )}
    </div>,
    { ...size },
  );
}
