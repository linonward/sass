import { desc, eq } from "drizzle-orm";
import type { Database, DbTransaction } from "@/core/db";
import { referralCodes, referralRelationships, user } from "@/core/db/schema";
import { newReferralCode } from "./code";

/** 状态先只有「等待首次付款」；奖励结算（T1306）在此基础上推进，不改变归属。 */
export type ReferralStatus = "awaiting_payment";
export type RelationshipView = { status: ReferralStatus; createdAt: Date };
export type InviterView = { userId: string; name: string };
export type BindResult =
  | { ok: true; inviterUserId: string }
  | { ok: false; reason: "invalid" | "self" | "exists" };

// 与 better-auth 的登录判断保持一致：过期封禁不算封禁，永久封禁的 banExpires 为空。
function activeBan(
  row: { banned: boolean | null; banExpires: Date | null },
  now: Date,
) {
  if (row.banned !== true) return false;
  return !row.banExpires || row.banExpires.getTime() >= now.getTime();
}

export function createReferralService(db: Database) {
  async function readInviter(
    tx: Database | DbTransaction,
    code: string,
    now: Date,
  ): Promise<InviterView | null> {
    const [row] = await tx
      .select({
        userId: user.id,
        name: user.name,
        banned: user.banned,
        banExpires: user.banExpires,
      })
      .from(referralCodes)
      .innerJoin(user, eq(user.id, referralCodes.userId))
      .where(eq(referralCodes.code, code));
    if (!row || activeBan(row, now)) return null;
    return { userId: row.userId, name: row.name };
  }
  return {
    /** 一人一码，反复调用返回同一个码。 */
    async ensureCode(userId: string) {
      const [existing] = await db
        .select({ code: referralCodes.code })
        .from(referralCodes)
        .where(eq(referralCodes.userId, userId));
      if (existing) return existing.code;
      // 码是随机生成的：撞码或并发插入都不改写既有归属，冲突后重试或读回。
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [created] = await db
          .insert(referralCodes)
          .values({ code: newReferralCode(), userId })
          .onConflictDoNothing()
          .returning({ code: referralCodes.code });
        if (created) return created.code;
        const [again] = await db
          .select({ code: referralCodes.code })
          .from(referralCodes)
          .where(eq(referralCodes.userId, userId));
        if (again) return again.code;
      }
      throw new Error("referral code allocation failed");
    },
    /** 有效邀请人：码存在且邀请人未被封禁。查不到一律返回 null，不区分原因。 */
    async resolveInviter(code: string, now = new Date()) {
      return readInviter(db, code, now);
    },
    /**
     * 绑定只在首次创建账号时调用（`user.create.after`）：受邀人是主键，
     * 并发注册、重复回调都只会留下一条关系，先到的胜出，之后不能更换。
     */
    async bind(
      input: { inviteeUserId: string; code: string },
      now = new Date(),
    ): Promise<BindResult> {
      return db.transaction(async (tx) => {
        const inviter = await readInviter(tx, input.code, now);
        if (!inviter) return { ok: false, reason: "invalid" } as const;
        // 自邀在服务端拦截：客户端只能提交码，关系和归属由服务端存储决定。
        if (inviter.userId === input.inviteeUserId)
          return { ok: false, reason: "self" } as const;
        const [created] = await tx
          .insert(referralRelationships)
          .values({
            inviteeUserId: input.inviteeUserId,
            inviterUserId: inviter.userId,
            code: input.code,
          })
          .onConflictDoNothing()
          .returning({ inviteeUserId: referralRelationships.inviteeUserId });
        if (!created) return { ok: false, reason: "exists" } as const;
        return { ok: true, inviterUserId: inviter.userId } as const;
      });
    },
    /** 当前用户作为受邀人的关系（有没有被人邀请过）。 */
    async relationshipFor(
      inviteeUserId: string,
    ): Promise<RelationshipView | null> {
      const [row] = await db
        .select({
          status: referralRelationships.status,
          createdAt: referralRelationships.createdAt,
        })
        .from(referralRelationships)
        .where(eq(referralRelationships.inviteeUserId, inviteeUserId));
      return row ?? null;
    },
    /** 邀请记录只回状态与时间：邀请人看不到受邀人的邮箱或身份。 */
    async listInvited(inviterUserId: string, limit = 50) {
      return db
        .select({
          status: referralRelationships.status,
          createdAt: referralRelationships.createdAt,
        })
        .from(referralRelationships)
        .where(eq(referralRelationships.inviterUserId, inviterUserId))
        .orderBy(desc(referralRelationships.createdAt))
        .limit(limit);
    },
  };
}
