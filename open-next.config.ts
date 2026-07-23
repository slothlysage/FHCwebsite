import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults only: no incremental cache binding yet — every catalog route is
// force-dynamic (database is the source of truth, AGENT.md), so there is
// nothing for an ISR cache to hold. Revisit if static/ISR pages appear.
export default defineCloudflareConfig();
