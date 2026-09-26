import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** 是否运行在 Vercel 上（生产或预览部署）。 */
function onVercel(runtimeEnv: RuntimeEnv) {
  return Boolean(runtimeEnv.VERCEL_ENV);
}

/**
 * 登录模块的变量。
 * - `BETTER_AUTH_SECRET` 始终必填（签名 session、加密数据）。
 * - Google 凭据在 Vercel 生产环境必填；本地、CI 和预览可以不填，此时只提供邮箱验证码登录。
 */
export function authServerEnv(runtimeEnv: RuntimeEnv) {
  const production = runtimeEnv.VERCEL_ENV === "production";
  return {
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url().optional(),
    GOOGLE_CLIENT_ID: requiredWhen(production, z.string().min(1)),
    GOOGLE_CLIENT_SECRET: requiredWhen(production, z.string().min(1)),
  };
}

type DynamicBaseURL = {
  allowedHosts: string[];
  protocol: "http" | "https";
  fallback?: string;
};

/**
 * Better Auth 的 baseURL（决定 OAuth 回调地址和可信来源）。
 * - 设置了 `BETTER_AUTH_URL` 时直接使用。
 * - 否则按请求的 Host 动态确定，但只接受已知的主机：生产域名、本次部署的
 *   Vercel 地址（每个预览都不同）以及本地开发地址，不放开整个 *.vercel.app。
 */
export function resolveAuthBaseURL(
  runtimeEnv: RuntimeEnv,
  domain: string,
): string | DynamicBaseURL {
  if (runtimeEnv.BETTER_AUTH_URL) return runtimeEnv.BETTER_AUTH_URL;

  if (onVercel(runtimeEnv)) {
    const hosts = [
      domain,
      runtimeEnv.VERCEL_PROJECT_PRODUCTION_URL,
      runtimeEnv.VERCEL_BRANCH_URL,
      runtimeEnv.VERCEL_URL,
    ].filter((host): host is string => Boolean(host));
    return {
      allowedHosts: [...new Set(hosts)],
      protocol: "https",
      fallback:
        runtimeEnv.VERCEL_ENV === "production"
          ? `https://${domain}`
          : `https://${runtimeEnv.VERCEL_BRANCH_URL ?? runtimeEnv.VERCEL_URL}`,
    };
  }

  return { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" };
}

/**
 * 是否提供 Google 登录：凭据齐全，且不是 Vercel 预览部署。
 * 预览地址每次都不同，无法逐个登记为 Google 的回调地址，预览只提供邮箱验证码登录。
 */
export function googleCredentials(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.VERCEL_ENV === "preview") return undefined;
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } =
    runtimeEnv;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * Google 登录是否可用的**唯一**判断依据：登录页按钮、One Tap 提示和 CSP 白名单
 * 三处都用它。分散判断会让预览部署出现「客户端弹了提示、服务端却禁用」的错配。
 *
 * 只返回 client ID：它本来就会随 GIS 脚本发到浏览器，而 CSP 是公开响应头，
 * 不该让安全模块碰到 client secret。
 */
export function googleClientId(runtimeEnv: RuntimeEnv) {
  return googleCredentials(runtimeEnv)?.clientId;
}
