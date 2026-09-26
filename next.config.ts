import type { NextConfig } from "next";
import { withContentCollections } from "@content-collections/next";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

// 在 dev / build 启动时校验 site.config.ts 与环境变量，出错立即失败。
import siteConfig from "./site.config";
import "./src/core/env";
import { canUploadSourceMaps } from "./src/core/observability/env";
import { SENTRY_TUNNEL_ROUTE } from "./src/core/observability/tunnel";
import { securityHeaders } from "./src/core/security/headers";

const withNextIntl = createNextIntlPlugin("./src/core/i18n/request.ts");

const sentryEnabled =
  siteConfig.features.observability && siteConfig.observability.sentry;

const nextConfig: NextConfig = {
  env: {
    // 构建时写死，instrumentation 按它决定是否加载 Sentry；关闭时 SDK 不会打进产物。
    OBSERVABILITY_SENTRY: String(sentryEnabled),
  },
  // 全站安全响应头（含 CSP），策略见 src/core/security/headers.ts。
  // 用 `/:path*` 覆盖所有路径：proxy.ts 的 matcher 排除了 /api、/_next、/monitoring
  // 和带扩展名的静态文件，这些路径只经过这里。
  headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          runtimeEnv: process.env,
          isDev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

// 只在开启 observability.sentry 时套上 Sentry 的构建配置。
function withSentry(config: NextConfig) {
  if (!sentryEnabled) return config;
  const uploadSourceMaps = canUploadSourceMaps(process.env);
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // 三个变量都填了才上传 source map；上传后从产物里删掉，不对外公开。
    sourcemaps: {
      disable: !uploadSourceMaps,
      deleteSourcemapsAfterUpload: true,
    },
    widenClientFileUpload: uploadSourceMaps,
    // 浏览器事件经本站转发，减少被广告拦截插件拦掉。proxy.ts 的 matcher 要跳过这个路径。
    tunnelRoute: SENTRY_TUNNEL_ROUTE,
    silent: !process.env.CI,
    telemetry: false,
  });
}

// withContentCollections 返回 Promise，必须放在最外层。它在 dev / build 时生成 content/blog 的文章数据。
export default withContentCollections(withSentry(withNextIntl(nextConfig)));
