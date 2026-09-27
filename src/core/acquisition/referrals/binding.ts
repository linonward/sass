import { referralFromHeaders } from "../tokens";
import type { createReferralService } from "./service";

/**
 * 注册时绑定邀请人：只认浏览器里签名过的邀请上下文，码对应的邀请人由服务端再查一次
 * （存在且未被封禁）。绑定失败或上下文无效不能影响注册本身。
 */
export function createReferralBinding(deps: {
  enabled: boolean;
  secret: string;
  bind: ReturnType<typeof createReferralService>["bind"];
  warn: (event: string, fields?: Record<string, unknown>) => void;
}) {
  return async (userId: string, headers?: Headers) => {
    if (!deps.enabled) return;
    const pending = referralFromHeaders(headers, deps.secret);
    if (!pending) return;
    try {
      const result = await deps.bind({
        inviteeUserId: userId,
        code: pending.code,
      });
      if (!result.ok)
        deps.warn("referrals.bind_rejected", {
          userId,
          reason: result.reason,
        });
    } catch (error) {
      // 关系只有这一次机会：失败留下告警，交给运维判断是否补偿。
      deps.warn("referrals.bind_failed", { error, userId });
    }
  };
}
