import { defineRouting } from "next-intl/routing";

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./locale-cookie";
import { defaultLocale, locales } from "./locales";

// 语言清单从 ./locales 读，**不要改成从 site.config.ts 读**：这个模块被客户端组件间接引用
// （客户端组件 → core/i18n/navigation.ts → 这里），读配置会把 zod 和整个配置 schema
// 拖进每一个页面的客户端 bundle。详见 ./locales.ts 的注释。
export const routing = defineRouting({
  locales,
  defaultLocale,
  // 默认语言不带前缀（/pricing），其他语言带前缀（/zh/pricing）。
  localePrefix: "as-needed",
  // 访问**不带前缀**的地址（/、/pricing）时按语言偏好跳转，顺序是：
  // 地址前缀 → cookie → Accept-Language → 默认语言。带前缀的地址永远是它自己那门语言。
  // 写出来是因为它得是**有意的**：next-intl 的默认值恰好也是 true，但要关掉它必须知道有这一项
  // （关掉后浏览器是中文的访客默认看到英文站），所以这里不为「省一行」而省略。文档见 docs/i18n.md。
  localeDetection: true,
  // 这一项只用来**读** cookie（上面那条的优先级 2）。写由语言切换器负责 —— 中间件会在
  // 「访问了带前缀的地址」时自己写一个，那正是「点开一条 /zh 链接就被记成中文」的来源，
  // 所以 proxy 会把它删掉。名字与有效期从 ./locale-cookie 共用。
  localeCookie: {
    name: LOCALE_COOKIE,
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  },
});
