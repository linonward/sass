import { defineRouting } from "next-intl/routing";

import siteConfig from "../../../site.config";

export const routing = defineRouting({
  locales: siteConfig.locales,
  defaultLocale: siteConfig.defaultLocale,
  // 默认语言不带前缀（/pricing），其他语言带前缀（/zh/pricing）。
  localePrefix: "as-needed",
});
