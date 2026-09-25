import { z } from "zod";

import type { Credits } from "@/core/credits";

/** 后台调整积分的流水来源；sourceId 是表单渲染时生成的请求 ID，重复提交只生效一次。 */
export const ADMIN_ADJUST_SOURCE = "admin";

export const adjustCreditsInput = z.object({
  userId: z.string().min(1),
  amount: z.coerce
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((n) => n !== 0, "must not be zero"),
  // 必须填写原因，写进流水的 reason。
  reason: z.string().trim().min(1).max(500),
  requestId: z.uuid(),
});

export type AdjustCreditsInput = z.input<typeof adjustCreditsInput>;

/**
 * 管理员调整某个用户的积分：写一条 adjust 流水，actor_id 记录操作的管理员。
 * 负数调整不能让余额低于 0（抛 InsufficientCreditsError）。
 */
export async function adjustUserCredits(
  credits: Pick<Credits, "adjustCredits">,
  adminId: string,
  input: AdjustCreditsInput,
) {
  const { userId, amount, reason, requestId } = adjustCreditsInput.parse(input);
  return credits.adjustCredits({
    userId,
    amount,
    reason,
    source: ADMIN_ADJUST_SOURCE,
    sourceId: requestId,
    actorId: adminId,
  });
}
