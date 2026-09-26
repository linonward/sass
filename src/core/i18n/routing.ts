import { defineRouting } from "next-intl/routing";

import { defaultLocale, locales } from "./locales";

// 语言清单从 ./locales 读，**不要改成从 site.config.ts 读**：这个模块被客户端组件间接引用
// （客户端组件 → core/i18n/navigation.ts → 这里），读配置会把 zod 和整个配置 schema
// 拖进每一个页面的客户端 bundle。详见 ./locales.ts 的注释。
export const routing = defineRouting({
  locales,
  defaultLocale,
  // 默认语言不带前缀（/pricing），其他语言带前缀（/zh/pricing）。
  localePrefix: "as-needed",
});
