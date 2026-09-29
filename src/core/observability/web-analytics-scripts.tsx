import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { webAnalyticsFlags } from "./web-analytics";

/**
 * Vercel Analytics and Speed Insights, mounted in the root layout. When off, nothing renders and
 * the page loads no analytics scripts.
 * Neither uses cookies. View the data on the Analytics / Speed Insights pages of the Vercel project
 * (enable them in the project first).
 */
export function WebAnalyticsScripts({
  flags = webAnalyticsFlags(),
}: {
  flags?: { analytics: boolean; speedInsights: boolean };
}) {
  return (
    <>
      {flags.analytics && <Analytics />}
      {flags.speedInsights && <SpeedInsights />}
    </>
  );
}
