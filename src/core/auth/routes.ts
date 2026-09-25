/** 登录页路径（不含语言前缀）。 */
export const SIGN_IN_PATH = "/sign-in";

/** 登录后默认进入的页面（不含语言前缀）。 */
export const AFTER_SIGN_IN_PATH = "/dashboard";

/**
 * 需要登录才能访问的路径前缀（不含语言前缀），对应 `src/app/[locale]/(app)/` 下的页面。
 * proxy 据此做基于 cookie 的快速拦截；(app) 的 layout 另有服务端 session 校验兜底。
 * 在 (app) 下新增一级路由时在这里登记。
 */
export const protectedPrefixes: readonly string[] = ["/dashboard"];

export function isProtectedPath(path: string) {
  return protectedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
