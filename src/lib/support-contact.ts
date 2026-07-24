import { env } from "@/lib/env";

// Resolves the support/contact email shown on public policy pages (terms,
// shipping, returns, FAQ). No admin-configurable "store contact email"
// setting exists yet — specs/04-admin.md's Settings section only lists it as
// a future field ("store contact details"). Once that Settings page ships,
// prefer its value here and fall back to ADMIN_EMAIL, mirroring the
// resolution order specs/04-admin.md's "Owner notifications" section already
// uses for the same env var. Until then this is the only source.
export function getSupportEmail(): string | null {
  return env.ADMIN_EMAIL ?? null;
}
