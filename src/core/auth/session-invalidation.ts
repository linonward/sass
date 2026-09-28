import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/** emailOTP 插件改邮箱的端点（`changeEmail.enabled` 打开后存在）。 */
export const EMAIL_CHANGE_PATH = "/email-otp/change-email";

/**
 * 端点是不是成功改完了邮箱。端点返回 `{ success: true }`，出错时 after 钩子照样会跑
 * （dispatch 把 APIError 当成返回值塞进 `ctx.context.returned`），所以只认这个字段，
 * 不能用"钩子跑了"当作成功。
 */
export function emailChangeSucceeded(returned: unknown) {
  return (
    typeof returned === "object" &&
    returned !== null &&
    (returned as { success?: unknown }).success === true
  );
}

/**
 * 改邮箱成功后作废该用户的全部 session（含当前这个）。
 *
 * 邮箱是找回账号的凭据，改完邮箱等于换了身份入口：改邮箱前拿到 session 的人（旧设备、
 * 被偷走的 cookie）必须立刻下线，不能继续用旧身份访问。做完用户拿新邮箱重新登录。
 *
 * 注意只用 `/email-otp/change-email` 这一个端点。核心插件的链接式 `/change-email`
 * （`user.changeEmail.enabled`）本仓库没开，它的返回形状也不同（`{ status: true }`），
 * 将来要开的话得把它一并纳入判定。
 */
export function revokeSessionsOnEmailChange() {
  return {
    id: "revoke-sessions-on-email-change",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === EMAIL_CHANGE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            if (!emailChangeSucceeded(ctx.context.returned)) return;
            const userId = ctx.context.session?.user.id;
            if (!userId) return;
            await ctx.context.internalAdapter.deleteUserSessions(userId);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
