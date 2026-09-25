import type * as SentryNext from "@sentry/nextjs";

import type { ErrorReporter, LogFields } from "./logger";

// 这里只用类型，不引入 SDK：关闭 Sentry 时不打包、不加载 @sentry/nextjs。
// SDK 由 sentry.server.ts / sentry.edge.ts / sentry.client.ts 初始化后注册进来。
export type SentryApi = Pick<
  typeof SentryNext,
  "captureException" | "setUser" | "withScope"
>;

// 存在 globalThis：instrumentation 和各路由的 bundle 不一定共享模块实例（同 Sentry 自己的做法）。
const KEY = Symbol.for("sass.observability.sentry");
type Holder = {
  [KEY]?: { api?: SentryApi; pendingUserId?: string | null };
};

function holder() {
  return ((globalThis as Holder)[KEY] ??= {});
}

function current() {
  return holder().api;
}

/** 初始化完成后调用；传 undefined 取消注册（测试用）。 */
export function registerSentry(api: SentryApi | undefined) {
  const state = holder();
  state.api = api;
  // 浏览器端 SDK 是动态加载的，页面可能先调用了 identifyUser，这里补上。
  if (api && state.pendingUserId !== undefined) {
    api.setUser(state.pendingUserId ? { id: state.pendingUserId } : null);
  }
  state.pendingUserId = undefined;
}

/**
 * Sentry 初始化参数的公共部分。SDK 默认会收集 cookie、请求头、query、请求体、AI 输入输出、
 * 数据库参数和堆栈里的局部变量，这里全部关掉；用户只由 identifyUser 设置 ID，不自动带 IP 和邮箱。
 */
export function sentryBaseOptions({
  dsn,
  environment,
}: {
  dsn: string | undefined;
  environment: string | undefined;
}) {
  return {
    dsn,
    environment,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ["user-agent", "referer", "content-type"] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  } satisfies Parameters<typeof SentryNext.init>[0];
}

/**
 * logger.error 的上报：事件名做 tag，其余字段（已脱敏）做 extra；字段里有 userId 时设为用户。
 * 没有 Error 时用事件名造一个，方便在 Sentry 里按事件分组。
 */
export const reportToSentry: ErrorReporter = (error, event, fields) => {
  const sentry = current();
  if (!sentry) return;
  sentry.withScope((scope) => {
    scope.setTag("event", event);
    // error 已经作为异常本身上报，不再重复放进 extra。
    const { userId, ...extra } = fields as LogFields;
    delete extra.error;
    if (typeof userId === "string") scope.setUser({ id: userId });
    scope.setExtras(extra);
    sentry.captureException(error ?? new Error(event));
  });
};

/** 当前请求（服务端）或当前页面（浏览器）的登录用户；只发 ID。 */
export function identifyUser(userId: string | null | undefined) {
  const api = current();
  if (api) api.setUser(userId ? { id: userId } : null);
  // 只在浏览器里暂存：服务端的 SDK 在启动时就注册好了，暂存会串到别的请求。
  else if (typeof window !== "undefined")
    holder().pendingUserId = userId ?? null;
}

/** 客户端错误边界（error.tsx / global-error.tsx）用。 */
export function captureError(error: unknown) {
  current()?.captureException(error);
}
