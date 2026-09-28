/**
 * 记住用户语言选择的 cookie。**这个模块不 import 任何东西**（理由同 ./locales.ts）：
 * edge middleware（`src/proxy.ts`）、客户端组件（`./locale-switcher.tsx`）和 e2e 断言
 * 都要读它，谁都不该为了一个常量把依赖拖进来。
 *
 * 语义是「用户明确选过这门语言」，不是「访客来过这个语言的页面」：
 * 只有语言切换器写它，中间件自己写的那份会被 proxy 删掉。原因见 src/proxy.ts。
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** 一年。next-intl 默认不设 max-age（会话 cookie），重启浏览器就忘了，这里显式写成持久 cookie。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
