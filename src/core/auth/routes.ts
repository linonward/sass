import siteConfig from "../../../site.config";

/** 登录页路径（不含语言前缀）。 */
export const SIGN_IN_PATH = "/sign-in";

/** 登录后默认进入的页面（不含语言前缀）。 */
export const AFTER_SIGN_IN_PATH = "/dashboard";

/** 路径是否落在某个前缀下（`/a` 覆盖 `/a` 和 `/a/b`，不覆盖 `/ab`）。 */
function underPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * 由模块开关决定存在与否的页面。开着的照旧要登录（并进 protectedPrefixes），
 * 关掉的整块下线：proxy 在渲染前直接 404（见 disabledPrefixes）。
 */
const moduleGatedPages: ReadonlyArray<{ href: string; enabled: boolean }> = [
  // 邀请页：关闭时页面自身也会 notFound()，但 (app) 的 layout 会把未登录访客
  // 先送去登录页（layout 先渲染），所以真正的判定必须在 proxy 里做。
  { href: "/referrals", enabled: siteConfig.acquisition.referrals.enabled },
  // 示例业务模块（发票，src/features/invoices/）：关掉时 /invoices 整块下线，
  // 开着时和其他 (app) 页面一样要登录 —— 登录后带 callbackURL 回到原页面。
  { href: "/invoices", enabled: siteConfig.features.examples.invoices },
];

/**
 * 需要登录才能访问的路径前缀（不含语言前缀），对应 `src/app/[locale]/(app)/` 下的页面。
 * proxy 据此做基于 cookie 的快速拦截（带上 callbackURL，登录后回到原页面）；
 * (app) 的 layout 另有服务端 session 校验兜底。
 * 业务页面写进 site.config.ts 的 dashboard.nav 后自动加入，不需要改这里。
 */
export const protectedPrefixes: readonly string[] = [
  "/dashboard",
  "/settings",
  "/billing",
  "/playground",
  // 邀请页只在模块开启时才需要登录；关闭时见 disabledPrefixes（那里直接 404）。
  ...moduleGatedPages.filter((page) => page.enabled).map((page) => page.href),
  // API Key 页同上，由 site.config.ts 的 apiKeys.enabled 决定是否真的存在。
  "/api-keys",
  ...siteConfig.dashboard.nav.map((item) => item.href),
];

/**
 * 模块关闭后不再存在的页面路径（不含语言前缀）。proxy 对这些路径直接返回 404：
 * (app) 的 layout 和 page 并行渲染、但 layout 先跑完，未登录访客会被它先送去登录页，
 * 于是同一个地址对未登录是 307、对已登录是 404。判定挪到渲染之前，两种身份一致
 * （和 `/admin` 对非管理员一律 404 同一个道理，见 README「错误与权限的边界」）。
 */
export const disabledPrefixes: readonly string[] = moduleGatedPages
  .filter((page) => !page.enabled)
  .map((page) => page.href);

export function isProtectedPath(path: string) {
  return protectedPrefixes.some((prefix) => underPrefix(path, prefix));
}

export function isDisabledPath(path: string) {
  return disabledPrefixes.some((prefix) => underPrefix(path, prefix));
}
