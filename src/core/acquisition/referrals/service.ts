import { count, desc, eq } from "drizzle-orm";
import type { Database, DbTransaction } from "@/core/db";
import {
  referralCodes,
  referralRelationships,
  referralRewardDebt,
  referralRewards,
  user,
} from "@/core/db/schema";
import { newReferralCode } from "./code";

/**
 * Referral relationship status, including the reward settlement states rewarded / revoked /
 * pending_review.
 */
export type ReferralStatus =
  "awaiting_payment" | "rewarded" | "revoked" | "pending_review";
export type RelationshipView = { status: ReferralStatus; createdAt: Date };
export type InviterView = { userId: string; name: string };
export type BindResult =
  | { ok: true; inviterUserId: string }
  | { ok: false; reason: "invalid" | "self" | "exists" };

export type RewardView = {
  id: string;
  type: "granted" | "revoked";
  inviterCredits: number;
  inviteeCredits: number;
  orderRef: string;
  createdAt: Date;
};

export type DebtView = {
  id: string;
  amount: number;
  createdAt: Date;
};

// Matches better-auth's sign-in check: an expired ban doesn't count as a ban, and a permanent ban
// has an empty banExpires.
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
    /** One code per user; repeated calls return the same code. */
    async ensureCode(userId: string) {
      const [existing] = await db
        .select({ code: referralCodes.code })
        .from(referralCodes)
        .where(eq(referralCodes.userId, userId));
      if (existing) return existing.code;
      // Codes are random: neither a collision nor a concurrent insert rewrites an existing owner;
      // on conflict, retry or read back.
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
    /**
     * Valid inviter: the code exists and the inviter isn't banned. Any miss returns null, without
     * saying why.
     */
    async resolveInviter(code: string, now = new Date()) {
      return readInviter(db, code, now);
    },
    /**
     * Binding is only called when the account is first created (`user.create.after`): the invitee
     * is the primary key, so concurrent sign-ups and repeated callbacks leave a single
     * relationship. The first one wins and can't be changed afterwards.
     */
    async bind(
      input: { inviteeUserId: string; code: string },
      now = new Date(),
    ): Promise<BindResult> {
      return db.transaction(async (tx) => {
        const inviter = await readInviter(tx, input.code, now);
        if (!inviter) return { ok: false, reason: "invalid" } as const;
        // Self-referral is blocked on the server: the client can only submit a code, and the
        // relationship and attribution are decided by server-side storage.
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
    /** The current user's relationship as an invitee (whether someone invited them). */
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
    /**
     * Invite records only return status and time: the inviter can't see the invitee's email or
     * identity. `total` is the real total and `rows` only holds the latest `limit` entries — the
     * number on the page must not lie because of pagination.
     */
    async listInvited(inviterUserId: string, limit = 50) {
      const [rows, [counted]] = await Promise.all([
        db
          .select({
            status: referralRelationships.status,
            createdAt: referralRelationships.createdAt,
          })
          .from(referralRelationships)
          .where(eq(referralRelationships.inviterUserId, inviterUserId))
          .orderBy(desc(referralRelationships.createdAt))
          .limit(limit),
        db
          .select({ total: count() })
          .from(referralRelationships)
          .where(eq(referralRelationships.inviterUserId, inviterUserId)),
      ]);
      return { rows, total: counted?.total ?? 0 };
    },
    /** A user's reward events (as inviter or invitee). */
    async listRewards(userId: string, limit = 20): Promise<RewardView[]> {
      const rows = await db
        .select({
          id: referralRewards.id,
          type: referralRewards.type,
          inviterCredits: referralRewards.inviterCredits,
          inviteeCredits: referralRewards.inviteeCredits,
          orderRef: referralRewards.orderRef,
          createdAt: referralRewards.createdAt,
        })
        .from(referralRewards)
        .where(eq(referralRewards.inviteeUserId, userId))
        .orderBy(desc(referralRewards.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        ...r,
        type: r.type as "granted" | "revoked",
      }));
    },
    /** Reward events a user earned as an inviter. */
    async listInviterRewards(
      inviterUserId: string,
      limit = 20,
    ): Promise<RewardView[]> {
      const rows = await db
        .select({
          id: referralRewards.id,
          type: referralRewards.type,
          inviterCredits: referralRewards.inviterCredits,
          inviteeCredits: referralRewards.inviteeCredits,
          orderRef: referralRewards.orderRef,
          createdAt: referralRewards.createdAt,
        })
        .from(referralRewards)
        .where(eq(referralRewards.inviterUserId, inviterUserId))
        .orderBy(desc(referralRewards.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        ...r,
        type: r.type as "granted" | "revoked",
      }));
    },
    /** A user's outstanding debts. */
    async listDebts(userId: string): Promise<DebtView[]> {
      return db
        .select({
          id: referralRewardDebt.id,
          amount: referralRewardDebt.amount,
          createdAt: referralRewardDebt.createdAt,
        })
        .from(referralRewardDebt)
        .where(eq(referralRewardDebt.userId, userId));
    },
    /** Admin: all referral relationships (with an optional status filter). */
    async listAllRelationships({
      status,
      page = 1,
      limit = 20,
    }: {
      status?: ReferralStatus;
      page?: number;
      limit?: number;
    }) {
      const where = status
        ? eq(referralRelationships.status, status)
        : undefined;
      const offset = (page - 1) * limit;
      const [rows, [counted]] = await Promise.all([
        db
          .select({
            inviteeUserId: referralRelationships.inviteeUserId,
            inviterUserId: referralRelationships.inviterUserId,
            code: referralRelationships.code,
            status: referralRelationships.status,
            ruleSnapshot: referralRelationships.ruleSnapshot,
            createdAt: referralRelationships.createdAt,
          })
          .from(referralRelationships)
          .where(where)
          .orderBy(desc(referralRelationships.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(referralRelationships).where(where),
      ]);
      return {
        rows,
        total: counted?.total ?? 0,
        page,
        totalPages: Math.max(1, Math.ceil((counted?.total ?? 0) / limit)),
      };
    },
    /** Admin: all reward events. */
    async listAllRewards({ page = 1, limit = 20 }) {
      const offset = (page - 1) * limit;
      const [rows, [counted]] = await Promise.all([
        db
          .select({
            id: referralRewards.id,
            inviteeUserId: referralRewards.inviteeUserId,
            inviterUserId: referralRewards.inviterUserId,
            orderRef: referralRewards.orderRef,
            type: referralRewards.type,
            inviterCredits: referralRewards.inviterCredits,
            inviteeCredits: referralRewards.inviteeCredits,
            createdAt: referralRewards.createdAt,
          })
          .from(referralRewards)
          .orderBy(desc(referralRewards.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(referralRewards),
      ]);
      return {
        rows: rows.map((r) => ({
          ...r,
          type: r.type as "granted" | "revoked",
        })),
        total: counted?.total ?? 0,
        page,
        totalPages: Math.max(1, Math.ceil((counted?.total ?? 0) / limit)),
      };
    },
  };
}
