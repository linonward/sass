import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { webAnalyticsFlags } from "./web-analytics";

/**
 * 根布局里挂载的 Vercel Analytics 和 Speed Insights。关闭时什么都不渲染，页面不加载分析脚本。
 * 两者都不用 cookie；数据在 Vercel 项目的 Analytics / Speed Insights 页查看（需在项目里先开启）。
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
