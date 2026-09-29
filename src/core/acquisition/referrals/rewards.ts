import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DbTransaction } from "@/core/db";
import { referralRewardDebt } from "@/core/db/schema";
import { logger } from "@/core/observability/logger";

/**
 * Repays a user's referral reward debts (FIFO).
 * Called after credits are granted; uses the current balance to pay off the oldest debts first.
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

  // Read the current balance (already inside the caller's transaction, so no separate locking step
  // is needed). Note: the balance is read straight from the user_credits table
  const balanceResult = await tx.execute(
    sql`SELECT balance FROM user_credits WHERE user_id = ${userId} FOR UPDATE`,
  );
  const balanceRows = (balanceResult as { rows: { balance: number }[] }).rows;
  let balance: number = balanceRows[0] ? Number(balanceRows[0].balance) : 0;

  for (const debt of debts) {
    if (balance <= 0) break;
    const repay = Math.min(debt.amount, balance);
    if (repay <= 0) continue;

    // Deduct from the balance (updating user_credits by hand)
    await tx.execute(
      sql`UPDATE user_credits SET balance = balance - ${repay}, updated_at = now() WHERE user_id = ${userId} AND balance >= ${repay}`,
    );

    // Update the debt
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
