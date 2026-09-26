// Sentry 浏览器事件的转发路径（next.config.ts 的 tunnelRoute）。proxy.ts 的 matcher 要跳过它，
// 否则会被加上语言前缀或跳转到登录页。
export const SENTRY_TUNNEL_ROUTE = "/monitoring";
