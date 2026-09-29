import { and, count, desc, eq, isNull, max } from "drizzle-orm";

import type { Database } from "@/core/db";
import { user, userApiKeys } from "@/core/db/schema";

import { generateApiKey } from "./generate";
import { API_KEY_NAME_MAX } from "./name";

/** Key view for the UI and API: contains neither the plaintext nor the hash. */
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

/** A row in the admin list: how many keys a user has and when they were last used. */
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
    /** The current user's keys, newest first. */
    async listForUser(userId: string): Promise<ApiKeyView[]> {
      return db
        .select(viewColumns)
        .from(userApiKeys)
        .where(eq(userApiKeys.userId, userId))
        .orderBy(desc(userApiKeys.createdAt));
    },

    /**
     * Creates a key. The plaintext appears only once, in this return value; nobody (admins
     * included) can see it afterwards. Duplicate names for the same user are rejected: two keys
     * with the same name in a list can't be told apart.
     */
    async create(userId: string, name: string): Promise<CreateApiKeyResult> {
      // Leading and trailing spaces aren't part of the name: an all-space name is no name, and it
      // would look the same in the list.
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > API_KEY_NAME_MAX) {
        return { ok: false, reason: "invalid_name" };
      }
      const generated = generateApiKey();
      // A unique-constraint conflict (same name) goes through onConflictDoNothing: no relying on
      // catching database errors, and two concurrent submits still leave only one key.
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
     * Revokes: sets `revokedAt` without deleting the row (it stays in the list, where the user can
     * see "revoked"). Idempotent — an already revoked key or someone else's key returns false,
     * without an error and without rewriting the time.
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
     * Lookup for authentication. Revoked / expired keys are returned too, and the middleware
     * decides — the decision logic lives in one place so the two sides can't drift.
     */
    async findByHash(hashedKey: string): Promise<ApiKeyView | null> {
      const [row] = await db
        .select(viewColumns)
        .from(userApiKeys)
        .where(eq(userApiKeys.hashedKey, hashedKey));
      return row ?? null;
    },

    /**
     * Records the last usage time. Callers decide what to do if it throws (the middleware only
     * logs it; authentication is unaffected).
     */
    async touchLastUsed(keyId: string, at = new Date()): Promise<void> {
      await db
        .update(userApiKeys)
        .set({ lastUsedAt: at })
        .where(eq(userApiKeys.id, keyId));
    },

    /**
     * Admin: users with keys + key count + last usage time. Never includes plaintext or hashes —
     * revocation only affects activeCount; the details stay on the user's own page.
     */
    async listOwners(limit = 100): Promise<ApiKeyOwnerView[]> {
      const rows = await db
        .select({
          userId: user.id,
          email: user.email,
          name: user.name,
          keyCount: count(userApiKeys.id),
          // Revoked rows stay in the table too; use them to derive the active count.
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
