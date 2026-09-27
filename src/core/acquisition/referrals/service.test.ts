// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { referralRelationships, user } from "@/core/db/schema";

import { newReferralCode } from "./code";
import { createReferralService } from "./service";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) throw new Error("DATABASE_URL_TEST required");

describe.skipIf(!url)("referral persistence", () => {
  let client: DbClient;
  let service: ReturnType<typeof createReferralService>;
  const created: string[] = [];

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    service = createReferralService(client.db);
  });

  afterAll(async () => {
    // 码和关系都挂在 user 上并级联删除，删掉用例创建的账号即可清干净。
    if (created.length)
      await client.db.delete(user).where(inArray(user.id, created));
    await client.close();
  });

  async function account(
    overrides: { banned?: boolean; banExpires?: Date | null } = {},
  ) {
    const value = {
      id: randomUUID(),
      name: "Referral test",
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      ...overrides,
    };
    created.push(value.id);
    await client.db.insert(user).values(value);
    return value;
  }

  async function relationshipsOf(inviteeId: string) {
    return client.db
      .select()
      .from(referralRelationships)
      .where(eq(referralRelationships.inviteeUserId, inviteeId));
  }

  test("一人一码：重复调用返回同一个码，不同账号互不相同", async () => {
    const first = await account();
    const second = await account();
    const code = await service.ensureCode(first.id);
    expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{12}$/);
    expect(await service.ensureCode(first.id)).toBe(code);
    expect(await service.ensureCode(second.id)).not.toBe(code);
  });

  test("有效邀请人：未封禁才算，过期封禁算未封禁，删号与未知码都不算", async () => {
    const live = await account();
    const expiredBan = await account({
      banned: true,
      banExpires: new Date(Date.now() - 1000),
    });
    const banned = await account({ banned: true, banExpires: null });
    const gone = await account();
    expect(
      await service.resolveInviter(await service.ensureCode(live.id)),
    ).toEqual({ userId: live.id, name: live.name });
    expect(
      await service.resolveInviter(await service.ensureCode(expiredBan.id)),
    ).toEqual({ userId: expiredBan.id, name: expiredBan.name });
    expect(
      await service.resolveInviter(await service.ensureCode(banned.id)),
    ).toBeNull();
    const goneCode = await service.ensureCode(gone.id);
    await client.db.delete(user).where(eq(user.id, gone.id));
    expect(await service.resolveInviter(goneCode)).toBeNull();
    expect(await service.resolveInviter(newReferralCode())).toBeNull();
    expect(await service.resolveInviter("not-a-code")).toBeNull();
  });

  test("并发注册、重复绑定只留一条关系，之后不能更换邀请人", async () => {
    const inviter = await account();
    const other = await account();
    const invitee = await account();
    const code = await service.ensureCode(inviter.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.bind({ inviteeUserId: invitee.id, code }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.reason === "exists"),
    ).toHaveLength(4);
    const rows = await relationshipsOf(invitee.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inviterUserId: inviter.id,
      code,
      status: "awaiting_payment",
    });
    // 换一个邀请人的码再绑一次：关系不变，码也不变。
    expect(
      await service.bind({
        inviteeUserId: invitee.id,
        code: await service.ensureCode(other.id),
      }),
    ).toEqual({ ok: false, reason: "exists" });
    expect((await relationshipsOf(invitee.id))[0]).toMatchObject({
      inviterUserId: inviter.id,
      code,
    });
  });

  test("自邀、无效码、封禁邀请人都建不了关系", async () => {
    const inviter = await account();
    const banned = await account({ banned: true, banExpires: null });
    const self = await account();
    const selfCode = await service.ensureCode(self.id);
    expect(
      await service.bind({ inviteeUserId: self.id, code: selfCode }),
    ).toEqual({ ok: false, reason: "self" });
    expect(
      await service.bind({
        inviteeUserId: inviter.id,
        code: newReferralCode(),
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await service.bind({
        inviteeUserId: inviter.id,
        code: await service.ensureCode(banned.id),
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await client.db
        .select()
        .from(referralRelationships)
        .where(
          inArray(referralRelationships.inviteeUserId, [self.id, inviter.id]),
        ),
    ).toHaveLength(0);
    // 同一个邀请人仍然可以被别人正常绑定。
    const invitee = await account();
    const code = await service.ensureCode(inviter.id);
    expect(await service.bind({ inviteeUserId: invitee.id, code })).toEqual({
      ok: true,
      inviterUserId: inviter.id,
    });
  });

  test("邀请记录只回状态和时间，不向邀请人暴露受邀人身份", async () => {
    const inviter = await account();
    const invitee = await account();
    const code = await service.ensureCode(inviter.id);
    await service.bind({ inviteeUserId: invitee.id, code });
    const rows = await service.listInvited(inviter.id);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["createdAt", "status"]);
    expect(rows[0]!.status).toBe("awaiting_payment");
    expect(await service.relationshipFor(invitee.id)).toMatchObject({
      status: "awaiting_payment",
    });
    expect(await service.relationshipFor(inviter.id)).toBeNull();
  });
});
