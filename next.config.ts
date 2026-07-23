import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes `next dev` emulate the Cloudflare Workers runtime bindings locally
// (no-op during `next build` and in production).
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Next's output tracing resolves pg's optional `pg-cloudflare` shim through
  // the exports "default" condition (an empty stub), so only the stub is
  // traced — but the OpenNext worker bundle resolves it under the "workerd"
  // condition and needs the real files. Force them into the trace.
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/pg-cloudflare/dist/**",
      "./node_modules/pg-cloudflare/esm/**",
    ],
  },
};

export default nextConfig;
