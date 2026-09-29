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
    // Codes and relationships belong to a user and cascade on delete, so deleting the accounts the
    // tests created cleans everything up.
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

  test("one code per user: repeated calls return the same code, and different accounts get different codes", async () => {
    const first = await account();
    const second = await account();
    const code = await service.ensureCode(first.id);
    expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{12}$/);
    expect(await service.ensureCode(first.id)).toBe(code);
    expect(await service.ensureCode(second.id)).not.toBe(code);
  });

  test("valid inviter: only if not banned (an expired ban counts as not banned); deleted accounts and unknown codes don't count", async () => {
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

  test("concurrent sign-ups and repeated binds leave one relationship, and the inviter can't be changed afterwards", async () => {
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
    // Binding again with another inviter's code: the relationship and the code stay the same.
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

  test("self-referral, invalid codes, and banned inviters can't create a relationship", async () => {
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
    // The same inviter can still be bound normally by others.
    const invitee = await account();
    const code = await service.ensureCode(inviter.id);
    expect(await service.bind({ inviteeUserId: invitee.id, code })).toEqual({
      ok: true,
      inviterUserId: inviter.id,
    });
  });

  test("invite records only return status and time, never exposing the invitee's identity to the inviter", async () => {
    const inviter = await account();
    const invitee = await account();
    const code = await service.ensureCode(inviter.id);
    await service.bind({ inviteeUserId: invitee.id, code });
    const invited = await service.listInvited(inviter.id);
    expect(invited.total).toBe(1);
    expect(invited.rows).toHaveLength(1);
    expect(Object.keys(invited.rows[0]!).sort()).toEqual([
      "createdAt",
      "status",
    ]);
    expect(invited.rows[0]!.status).toBe("awaiting_payment");
    expect(await service.relationshipFor(invitee.id)).toMatchObject({
      status: "awaiting_payment",
    });
    expect(await service.relationshipFor(inviter.id)).toBeNull();
  });

  test("total is still the real count when the list is truncated (the page uses it to say only the latest N are shown)", async () => {
    const inviter = await account();
    const code = await service.ensureCode(inviter.id);
    for (const _ of [1, 2, 3])
      await service.bind({ inviteeUserId: (await account()).id, code });
    const page = await service.listInvited(inviter.id, 2);
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
    // Truncation always drops the oldest: with a larger limit the first two stay the same.
    const all = await service.listInvited(inviter.id, 10);
    expect(all.rows).toHaveLength(3);
    expect(all.total).toBe(3);
    expect(all.rows.slice(0, 2)).toEqual(page.rows);
  });
});
