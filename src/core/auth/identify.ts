import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

import { identifyUser } from "@/core/observability/sentry";

/** get-session 的返回值里取用户 ID；未登录或返回的是 Response 时为 null。 */
export function sessionUserId(returned: unknown): string | null {
  if (typeof returned !== "object" || returned === null) return null;
  const user = (returned as { user?: { id?: unknown } }).user;
  return typeof user?.id === "string" ? user.id : null;
}

/**
 * 每次读取 session（页面、Server Action、API 里的 auth.api.getSession）后，把用户 ID 交给
 * 当前请求的 Sentry scope，之后这个请求里上报的错误都带上用户 ID。没开 Sentry 时什么也不做。
 */
export function identifySessionUser() {
  return {
    id: "identify-session-user",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === "/get-session",
          handler: createAuthMiddleware(async (ctx) => {
            identifyUser(sessionUserId(ctx.context.returned));
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
