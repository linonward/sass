/**
 * 全站安全响应头。`next.config.ts` 的 `headers()` 用它，一次覆盖所有路径 —— 包括
 * `src/proxy.ts` 的 matcher 故意排除掉的 `/api`、`/_next`、`/monitoring` 和带扩展名的文件。
 *
 * **CSP 用的是静态策略，不带 nonce。** nonce 每个请求都得重新生成，Next 只在动态渲染时
 * 把它写进行内脚本，因此开 nonce 等于全站放弃静态预渲染和 CDN 缓存
 * （见 `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
 * 的「Static vs Dynamic Rendering with CSP」）。代价是 `script-src` 必须留 `'unsafe-inline'`：
 * 没有 nonce 可用的行内脚本（Next 注入的 RSC 数据、next-themes 的主题脚本）就只能这样放行。
 * 本站没有把用户内容当 HTML 渲染的地方，行内脚本的执行点仍然只有自己的构建产物。
 *
 * 改白名单前先想清楚：多加一项只是放宽，漏一项是**对应资源被浏览器直接拦掉**
 * （生成结果图片变破图、脚本不执行），而且拦掉的资源往往只是静默失败。
 */

export type SecurityHeader = { key: string; value: string };

type RuntimeEnv = Record<string, string | undefined>;

/** Vercel Analytics / Speed Insights 的脚本域。生产在 Vercel 上走同源的 `/_vercel/*`；
 * 本地开发和没接 Vercel 的部署走这个域上的调试脚本（SDK 按 `NODE_ENV` 选，见两个包的 `getScriptSrc`）。 */
const VERCEL_SCRIPTS_ORIGIN = "https://va.vercel-scripts.com";

/**
 * R2 的 S3 兼容接口域：浏览器直传（预签名 PUT）和私有文件的签名 GET 都打到这里。
 * 用通配而不是 `<account>.r2.cloudflarestorage.com`：CSP 是公开响应头，没必要把账号 ID
 * 写给每个访客；这个域是 Cloudflare 自己的，只接受带签名的请求。
 */
const R2_API_ORIGIN = "https://*.r2.cloudflarestorage.com";

/** `R2_PUBLIC_URL` 的源（`upload.public` 为 true 时生成结果的图片/视频直接用它）。 */
function r2PublicOrigin(runtimeEnv: RuntimeEnv): string | undefined {
  const value = runtimeEnv.R2_PUBLIC_URL?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    // 本地没配 R2 时这个值可能是空的或不是合法 URL；少一个白名单项，不在这里额外报错
    // （`upload.public` 为 true 时 upload 的 env 校验会先拦下生产环境的漏配）。
    return undefined;
  }
}

/** 生成结果的图片来源：公开域名 + R2 接口域（`upload.public` 为 false 时是签名 GET 地址）。 */
function mediaOrigins(runtimeEnv: RuntimeEnv): string[] {
  const publicOrigin = r2PublicOrigin(runtimeEnv);
  return publicOrigin ? [R2_API_ORIGIN, publicOrigin] : [R2_API_ORIGIN];
}

/**
 * 内容安全策略。
 *
 * 白名单的来源：
 * - `script-src` / `connect-src`：Vercel Analytics 与 Speed Insights；
 * - `img-src` / `media-src` / `connect-src`：R2（生成结果、上传直传）；
 * - `connect-src` 的 `'self'` 覆盖 Sentry 的转发路径 `/monitoring`（`next.config.ts` 的
 *   `tunnelRoute`，上报走本站同源地址）。**关掉 tunnelRoute 的话要在这里补上 Sentry 的 ingest 域。**
 */
export function contentSecurityPolicy({
  runtimeEnv,
  isDev,
}: {
  runtimeEnv: RuntimeEnv;
  isDev: boolean;
}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline'：Next 注入的 RSC 数据脚本、next-themes 的主题脚本都是行内脚本，
    // 静态 CSP 没有 nonce 可用。'unsafe-eval' 只在开发环境需要（React 用它重建服务端错误栈）。
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      VERCEL_SCRIPTS_ORIGIN,
    ],
    // 'unsafe-inline' 同时覆盖行内 <style> 和组件里的 style="..." 属性。
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", ...mediaOrigins(runtimeEnv)],
    "media-src": ["'self'", "blob:", ...mediaOrigins(runtimeEnv)],
    // next/font 在构建时把字体下载到 /_next/static/media，运行时不连外部域。
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      VERCEL_SCRIPTS_ORIGIN,
      ...mediaOrigins(runtimeEnv),
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    // 本地是 http，升级会把开发环境的子资源顶成 https；生产把漏掉的 http 子资源顶成 https。
    ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

/**
 * 每个响应都带的安全头。HSTS **不在这里**：域名定下来之前下发会被浏览器记住，
 * 上线清单（README）里作为一步手动开启。
 */
export function staticSecurityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // 防点击劫持；和 CSP 的 frame-ancestors 一起下发，后者被新浏览器优先采用。
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];
}

/** `next.config.ts` 的 `headers()` 的返回值。 */
export function securityHeaders({
  runtimeEnv,
  isDev,
}: {
  runtimeEnv: RuntimeEnv;
  isDev: boolean;
}): SecurityHeader[] {
  return [
    ...staticSecurityHeaders(),
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy({ runtimeEnv, isDev }),
    },
  ];
}
