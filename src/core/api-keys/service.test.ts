// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { user, userApiKeys } from "@/core/db/schema";

import { hashApiKey } from "./generate";
import { API_KEY_NAME_MAX } from "./name";
import { createApiKeyService } from "./service";
import { apiKeyStatus } from "./status";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) throw new Error("DATABASE_URL_TEST required");

describe.skipIf(!url)("api key persistence", () => {
  let client: DbClient;
  let service: ReturnType<typeof createApiKeyService>;
  const created: string[] = [];

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    service = createApiKeyService(client.db);
  });

  afterAll(async () => {
    // Keys belong to a user and cascade on delete, so deleting the accounts the tests created
    // cleans everything up.
    if (created.length)
      await client.db.delete(user).where(inArray(user.id, created));
    await client.close();
  });

  async function account() {
    const value = {
      id: randomUUID(),
      name: "API key test",
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
    };
    created.push(value.id);
    await client.db.insert(user).values(value);
    return value;
  }

  test("create returns one-time plaintext; only the hash and prefix are stored", async () => {
    const owner = await account();
    const result = await service.create(owner.id, "Production");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plaintext).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(result.key.prefix).toBe(result.plaintext.slice(0, 11));
    expect(result.key.name).toBe("Production");
    expect(result.key.revokedAt).toBeNull();
    expect(result.key.userId).toBe(owner.id);

    // The plaintext isn't stored: looking up by its hash works, looking up by the plaintext itself
    // (not in any column) doesn't. The auth path uses exactly this hash: the hash computed from the
    // plaintext finds this key.
    const found = await service.findByHash(hashApiKey(result.plaintext));
    expect(found?.id).toBe(result.key.id);
    const rows = await client.db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, owner.id));
    expect(JSON.stringify(rows)).not.toContain(result.plaintext);
    expect(rows[0]!.hashedKey).toMatch(/^[0-9a-f]{64}$/);

    // The list doesn't expose the plaintext either.
    const list = await service.listForUser(owner.id);
    expect(list.map((key) => key.id)).toEqual([result.key.id]);
    expect(JSON.stringify(list)).not.toContain(result.plaintext);
  });

  test("only one key per name; a duplicate name neither creates a key nor overwrites the existing one", async () => {
    const owner = await account();
    const first = await service.create(owner.id, "Same name");
    expect(first.ok).toBe(true);
    const second = await service.create(owner.id, "Same name");
    expect(second).toEqual({ ok: false, reason: "duplicate" });
    const list = await service.listForUser(owner.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(first.ok ? first.key.id : "");
  });

  test("different accounts can use the same name", async () => {
    const [a, b] = [await account(), await account()];
    expect((await service.create(a.id, "Shared")).ok).toBe(true);
    expect((await service.create(b.id, "Shared")).ok).toBe(true);
  });

  test("empty or too-long names are rejected without writing to the database", async () => {
    const owner = await account();
    for (const name of ["", " ".repeat(3), "x".repeat(API_KEY_NAME_MAX + 1)]) {
      expect(await service.create(owner.id, name)).toEqual({
        ok: false,
        reason: "invalid_name",
      });
    }
    expect(await service.listForUser(owner.id)).toHaveLength(0);
    // The limit itself is allowed.
    expect(
      (await service.create(owner.id, "x".repeat(API_KEY_NAME_MAX))).ok,
    ).toBe(true);
  });

  test("list shows newest first and only the user's own keys", async () => {
    const [mine, other] = [await account(), await account()];
    await service.create(mine.id, "First");
    await service.create(other.id, "Not mine");
    await service.create(mine.id, "Second");
    const list = await service.listForUser(mine.id);
    expect(list.map((key) => key.name)).toEqual(["Second", "First"]);
  });

  test("revoke sets revokedAt without deleting the row; revoking again neither errors nor changes the time", async () => {
    const owner = await account();
    const made = await service.create(owner.id, "To revoke");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const keyId = made.key.id;

    expect(await service.revoke(owner.id, keyId)).toBe(true);
    const [row] = await client.db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.id, keyId));
    expect(row!.revokedAt).toBeInstanceOf(Date);
    const firstRevokedAt = row!.revokedAt;

    // Idempotent: the second revoke returns false and doesn't overwrite the first time; the row
    // remains.
    expect(await service.revoke(owner.id, keyId)).toBe(false);
    const [again] = await client.db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.id, keyId));
    expect(again!.revokedAt).toEqual(firstRevokedAt);

    // After revoking it can still be looked up (the middleware decides it's invalid), and the list
    // still shows it as revoked.
    const found = await service.findByHash(row!.hashedKey);
    expect(found).not.toBeNull();
    expect(apiKeyStatus(found!)).toBe("revoked");
    expect((await service.listForUser(owner.id)).map((k) => k.id)).toContain(
      keyId,
    );
  });

  test("cannot revoke someone else's key", async () => {
    const [owner, other] = [await account(), await account()];
    const made = await service.create(owner.id, "Mine");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await service.revoke(other.id, made.key.id)).toBe(false);
    const [row] = await client.db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.id, made.key.id));
    expect(row!.revokedAt).toBeNull();
  });

  test("an expired key can still be looked up and is judged expired", async () => {
    const owner = await account();
    const made = await service.create(owner.id, "Expiring");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await client.db
      .update(userApiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userApiKeys.id, made.key.id));
    const found = await service.findByHash(hashApiKey(made.plaintext));
    expect(apiKeyStatus(found!)).toBe("expired");
  });

  test("touchLastUsed records the last usage time", async () => {
    const owner = await account();
    const made = await service.create(owner.id, "Used");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.key.lastUsedAt).toBeNull();
    const at = new Date("2026-02-03T04:05:06Z");
    await service.touchLastUsed(made.key.id, at);
    const list = await service.listForUser(owner.id);
    expect(list[0]!.lastUsedAt).toEqual(at);
  });

  test("admin list: counts and last usage per user, with no plaintext or hashes", async () => {
    const owner = await account();
    const quiet = await account();
    const kept = await service.create(owner.id, "Kept");
    const revoked = await service.create(owner.id, "Revoked");
    expect(kept.ok && revoked.ok).toBe(true);
    if (!kept.ok || !revoked.ok) return;
    await service.revoke(owner.id, revoked.key.id);
    await service.touchLastUsed(kept.key.id, new Date("2026-03-04T05:06:07Z"));
    // Another account has a key that was never used: lastUsedAt is null, and it should still be
    // listed.
    await service.create(quiet.id, "Never used");

    const owners = await service.listOwners(500);
    const mine = owners.find((row) => row.userId === owner.id);
    expect(mine).toMatchObject({
      email: owner.email,
      keyCount: 2,
      activeCount: 1,
    });
    expect(mine!.lastUsedAt).toEqual(new Date("2026-03-04T05:06:07Z"));
    const other = owners.find((row) => row.userId === quiet.id);
    expect(other).toMatchObject({ keyCount: 1, activeCount: 1 });
    expect(other!.lastUsedAt).toBeNull();

    // The admin can't see sensitive values: the plaintext isn't stored, and the hash isn't in the
    // result.
    expect(Object.keys(mine!)).not.toContain("hashedKey");
    expect(JSON.stringify(owners)).not.toContain(kept.plaintext);
    expect(JSON.stringify(owners)).not.toContain(kept.key.prefix.slice(3));
  });
});
