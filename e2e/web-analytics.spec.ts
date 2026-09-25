import { expect, test } from "@playwright/test";

import siteConfig from "../site.config";

const on = siteConfig.features.observability;
const analytics = on && siteConfig.observability.analytics;
const speedInsights = on && siteConfig.observability.speedInsights;

// Vercel Analytics / Speed Insights 的脚本和上报地址：生产构建走 /_vercel/*，开发模式走 va.vercel-scripts.com。
const INSIGHTS = /\/_vercel\/insights\/|va\.vercel-scripts\.com\/v1\/script/;
const SPEED_INSIGHTS =
  /\/_vercel\/speed-insights\/|vercel-scripts\.com\/v1\/speed-insights/;

test("分析脚本按 observability 配置加载", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const analyticsScript = page.locator(
    'script[data-sdkn^="@vercel/analytics"]',
  );
  const speedInsightsScript = page.locator(
    'script[data-sdkn^="@vercel/speed-insights"]',
  );

  if (analytics) {
    await expect(analyticsScript).toHaveCount(1);
  } else {
    await expect(analyticsScript).toHaveCount(0);
    expect(requests.filter((url) => INSIGHTS.test(url))).toEqual([]);
  }

  if (speedInsights) {
    await expect(speedInsightsScript).toHaveCount(1);
  } else {
    await expect(speedInsightsScript).toHaveCount(0);
    expect(requests.filter((url) => SPEED_INSIGHTS.test(url))).toEqual([]);
  }
});
