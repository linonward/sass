import type { MetadataRoute } from "next";

import { routing } from "@/core/i18n/routing";
import { localizedPath, siteUrl } from "@/core/seo/urls";

// 登录后和后台页面不需要收录。
const privatePaths = ["/dashboard", "/admin"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api",
        ...privatePaths.flatMap((path) =>
          routing.locales.map((locale) => localizedPath(locale, path)),
        ),
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
