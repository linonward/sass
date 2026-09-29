import type { SiteConfig } from "@/core/config/schema";

import siteConfig from "../../../site.config";

/**
 * Whether Vercel Analytics / Speed Insights are on; features.observability is the master switch.
 */
export function webAnalyticsFlags(
  config: Pick<SiteConfig, "features" | "observability"> = siteConfig,
) {
  const on = config.features.observability;
  return {
    analytics: on && config.observability.analytics,
    speedInsights: on && config.observability.speedInsights,
  };
}
