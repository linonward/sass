import { and, count, desc, eq, isNull, max } from "drizzle-orm";

import type { Database } from "@/core/db";
import { user, userApiKeys } from "@/core/db/schema";

import { generateApiKey } from "./generate";
import { API_KEY_NAME_MAX } from "./name";

/** 界面与接口用的 key 视图：不含明文，也不含哈希。 */
export type ApiKeyView = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type CreateApiKeyResult =
  | { ok: true; plaintext: string; key: ApiKeyView }
  | { ok: false; reason: "invalid_name" | "duplicate" };

/** 后台列表的一行：某个用户名下的 key 数量与最后使用时间。 */
export type ApiKeyOwnerView = {
  userId: string;
  email: string;
  name: string;
  keyCount: number;
  activeCount: number;
  lastUsedAt: Date | null;
};

const viewColumns = {
  id: userApiKeys.id,
  userId: userApiKeys.userId,
  name: userApiKeys.name,
  prefix: userApiKeys.prefix,
  createdAt: userApiKeys.createdAt,
  lastUsedAt: userApiKeys.lastUsedAt,
  expiresAt: userApiKeys.expiresAt,
  revokedAt: userApiKeys.revokedAt,
};

export function createApiKeyService(db: Database) {
  return {
    /** 当前用户的 key，新建的在前。 */
    async listForUser(userId: string): Promise<ApiKeyView[]> {
      return db
        .select(viewColumns)
        .from(userApiKeys)
        .where(eq(userApiKeys.userId, userId))
        .orderBy(desc(userApiKeys.createdAt));
    },

    /**
     * 新建一把 key。明文只在这个返回值里出现一次，之后任何人（包括管理员）都看不到。
     * 同一位用户名下重名会被拒绝：列表里两把同名 key 分不清哪把是哪把。
     */
    async create(userId: string, name: string): Promise<CreateApiKeyResult> {
      // 前后空格不算名字的一部分：全是空格的名字等于没起名字，列表里也看不出差别。
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > API_KEY_NAME_MAX) {
        return { ok: false, reason: "invalid_name" };
      }
      const generated = generateApiKey();
      // 唯一约束冲突（同名）走 onConflictDoNothing：不依赖捕获数据库错误，
      // 并发提交两次也只会留下一把。
      const [created] = await db
        .insert(userApiKeys)
        .values({
          userId,
          name: trimmed,
          prefix: generated.prefix,
          hashedKey: generated.hashedKey,
        })
        .onConflictDoNothing()
        .returning(viewColumns);
      if (!created) return { ok: false, reason: "duplicate" };
      return { ok: true, plaintext: generated.plaintext, key: created };
    },

    /**
     * 撤销：写 `revokedAt`，不删行（列表里留痕，用户看得到「已撤销」）。
     * 幂等 —— 已经撤销过或不是自己的 key 都返回 false，不报错、不改写时间。
     */
    async revoke(userId: string, keyId: string): Promise<boolean> {
      const [row] = await db
        .update(userApiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userApiKeys.id, keyId),
            eq(userApiKeys.userId, userId),
            isNull(userApiKeys.revokedAt),
          ),
        )
        .returning({ id: userApiKeys.id });
      return Boolean(row);
    },

    /**
     * 鉴权查库。已撤销 / 已过期的也照常返回，由中间件判定 ——
     * 判定逻辑只有一处，免得两边漂移。
     */
    async findByHash(hashedKey: string): Promise<ApiKeyView | null> {
      const [row] = await db
        .select(viewColumns)
        .from(userApiKeys)
        .where(eq(userApiKeys.hashedKey, hashedKey));
      return row ?? null;
    },

    /**
     * 记最后一次使用时间。抛错由调用方决定怎么办（中间件那边只记日志，不影响鉴权）。
     */
    async touchLastUsed(keyId: string, at = new Date()): Promise<void> {
      await db
        .update(userApiKeys)
        .set({ lastUsedAt: at })
        .where(eq(userApiKeys.id, keyId));
    },

    /**
     * 后台：有 key 的用户 + key 数量 + 最后使用时间。
     * 永远不含明文和哈希 —— 撤销状态只影响 activeCount，明细留在用户自己的页面上。
     */
    async listOwners(limit = 100): Promise<ApiKeyOwnerView[]> {
      const rows = await db
        .select({
          userId: user.id,
          email: user.email,
          name: user.name,
          keyCount: count(userApiKeys.id),
          // 已撤销的行也留在表里，用它反推有效数量。
          revokedCount: count(userApiKeys.revokedAt),
          lastUsedAt: max(userApiKeys.lastUsedAt),
        })
        .from(userApiKeys)
        .innerJoin(user, eq(user.id, userApiKeys.userId))
        .groupBy(user.id)
        .orderBy(desc(max(userApiKeys.lastUsedAt)))
        .limit(limit);
      return rows.map(({ revokedCount, ...row }) => ({
        ...row,
        activeCount: row.keyCount - revokedCount,
      }));
    },
  };
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
