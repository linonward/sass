import type { MetadataRoute } from "next";

import { siteUrl } from "@/core/seo/urls";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * 只挡机器端点，不挡页面。
       *
       * dashboard / admin 是 HTTP 页面，排除它们靠页面自己的 `noIndex`（两处都设了）
       * —— 被 Disallow 挡住的路径爬虫抓不到，也就读不到那条 noindex，有外链时反而
       * 可能以裸 URL 出现在结果里：两套封锁叠在一起是互相抵消。这些页面未登录时还会
       * 307 到同样 noindex 的登录页（见 src/proxy.ts），爬虫本来也拿不到可收录的内容。
       *
       * /api 是 JSON，没有 <meta> 可写（未匹配的路径用 X-Robots-Tag 兜底，见
       * src/app/api/[...rest]/route.ts）；这种没有 HTML 的端点才是 Disallow 的用武之地。
       */
      disallow: ["/api"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
