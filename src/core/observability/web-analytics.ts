import type { SiteConfig } from "@/core/config/schema";

import siteConfig from "../../../site.config";

/** Vercel Analytics / Speed Insights 是否开启：features.observability 是总开关。 */
export function webAnalyticsFlags(
  config: Pick<SiteConfig, "features" | "observability"> = siteConfig,
) {
  const on = config.features.observability;
  return {
    analytics: on && config.observability.analytics,
    speedInsights: on && config.observability.speedInsights,
  };
}
