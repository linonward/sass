/**
 * 语言清单。**这个模块不 import 任何东西，这是刻意的，不要把配置读进来。**
 *
 * 为什么它不放在 `site.config.ts` 里：`site.config.ts` 经 `defineConfig()` 跑 zod 校验
 * （`src/core/config/schema.ts`），而 `src/core/i18n/routing.ts` 被客户端组件间接引用
 * （客户端组件 → `core/i18n/navigation.ts` → `routing.ts`）。只要 `routing.ts` 读了
 * `site.config.ts`，**整个 zod 和配置 schema 就会被拖进每一个页面的客户端 bundle**
 * （实测 92 KB gzip，23/25 条路由中招）。所以语言清单单独放这里：它是纯数据、edge 安全
 * （`src/proxy.ts` 是 edge middleware 也会引），任何东西都拖不进来。
 *
 * 改语言时改这里。`site.config.ts` 从这里读取再交给 schema 校验，所以这里仍是唯一来源。
 */
export const locales = ["en"];

/** 默认语言，必须出现在上面的 `locales` 里（schema 会校验这条）。 */
export const defaultLocale = "en";
