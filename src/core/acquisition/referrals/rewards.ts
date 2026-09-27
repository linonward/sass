import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DbTransaction } from "@/core/db";
import { referralRewardDebt } from "@/core/db/schema";
import { logger } from "@/core/observability/logger";

/**
 * 偿还用户的推荐奖励债务（FIFO）。
 * 在积分发放之后调用，用当前余额还最早的债。
 */
export async function repayReferralDebts(
  tx: DbTransaction,
  userId: string,
): Promise<void> {
  const debts = await tx
    .select({
      id: referralRewardDebt.id,
      amount: referralRewardDebt.amount,
    })
    .from(referralRewardDebt)
    .where(
      and(
        eq(referralRewardDebt.userId, userId),
        isNull(referralRewardDebt.settledAt),
      ),
    )
    .orderBy(asc(referralRewardDebt.createdAt));

  if (debts.length === 0) return;

  // 读当前余额（已在调用方的事务里，无需额外锁）
  // 注意：余额直接读 user_credits 表
  const balanceResult = await tx.execute(
    sql`SELECT balance FROM user_credits WHERE user_id = ${userId} FOR UPDATE`,
  );
  const balanceRows = (balanceResult as { rows: { balance: number }[] }).rows;
  let balance: number = balanceRows[0] ? Number(balanceRows[0].balance) : 0;

  for (const debt of debts) {
    if (balance <= 0) break;
    const repay = Math.min(debt.amount, balance);
    if (repay <= 0) continue;

    // 扣减余额（手动更新 user_credits）
    await tx.execute(
      sql`UPDATE user_credits SET balance = balance - ${repay}, updated_at = now() WHERE user_id = ${userId} AND balance >= ${repay}`,
    );

    // 更新债务
    const remaining = debt.amount - repay;
    if (remaining <= 0) {
      await tx
        .update(referralRewardDebt)
        .set({ amount: 0, settledAt: new Date() })
        .where(eq(referralRewardDebt.id, debt.id));
    } else {
      await tx
        .update(referralRewardDebt)
        .set({ amount: remaining })
        .where(eq(referralRewardDebt.id, debt.id));
    }

    balance -= repay;
    logger.info("referrals.debt_repaid", {
      userId,
      debtId: debt.id,
      repaid: repay,
      remaining,
    });
  }
}
