// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { createDbClient, type DbClient } from "@/core/db/client";
import { leads, user } from "@/core/db/schema";
import { captureEntry } from "../context";
import { createAttributionStore } from "../store";
import { createLeadService, tokenHash } from "./service";
import { cleanupLeadsSql } from "./cleanup";
import { DAY } from "./input";
const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) throw new Error("DATABASE_URL_TEST required");
describe.skipIf(!url)("lead persistence", () => {
  let client: DbClient;
  let service: ReturnType<typeof createLeadService>;
  const listId = `test-${randomUUID()}`;
  const users: string[] = [];
  const now = new Date();
  const source = captureEntry(
    { pathname: "/", utm_source: "lead" },
    "site.test",
    now.getTime(),
  )!;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    service = createLeadService(client.db);
  });
  afterAll(async () => {
    for (const id of users) await client.db.delete(user).where(eq(user.id, id));
    await client.db.delete(leads).where(eq(leads.listId, listId));
    await client.close();
  });
  const input = () => ({
    email: `${randomUUID()}@example.com`,
    listId,
    consentVersion: "1",
    consentText: "Contact me about launch",
    snapshot: source,
  });
  async function row(id: string) {
    return (await client.db.select().from(leads).where(eq(leads.id, id)))[0]!;
  }
  async function account(
    email: string,
    createdAt = new Date(now.getTime() + 1000),
  ) {
    const value = {
      id: randomUUID(),
      name: "Lead test",
      email,
      emailVerified: true,
      createdAt,
    };
    users.push(value.id);
    await client.db.insert(user).values(value);
    return value;
  }
  test("concurrent normalized submissions create one pending lead and one delivery, storing only token hashes", async () => {
    const data = input();
    const deliveries = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.prepare(
          { ...data, email: ` ${data.email.toUpperCase()} ` },
          now,
        ),
      ),
    );
    const sent = deliveries.filter(Boolean);
    expect(sent).toHaveLength(1);
    const lead = await row(sent[0]!.id);
    expect(lead).toMatchObject({
      email: data.email,
      status: "pending",
      consentVersion: "1",
      consentText: data.consentText,
      userId: null,
      confirmHash: tokenHash(sent[0]!.confirmToken),
    });
    expect(JSON.stringify(lead)).not.toContain(sent[0]!.confirmToken);
    expect(lead.expiresAt.getTime() - now.getTime()).toBe(7 * DAY);
  });
  test("the same email can join separate lists without overwriting either record", async () => {
    const data = input();
    const first = (await service.prepare(data, now))!;
    const second = (await service.prepare(
      { ...data, listId: `${listId}-second` },
      now,
    ))!;
    try {
      expect(first.id).not.toBe(second.id);
      await service.confirm(first.confirmToken, now);
      expect((await row(second.id)).status).toBe("pending");
    } finally {
      await client.db.delete(leads).where(eq(leads.id, second.id));
    }
  });
  test("mail failure releases only the current send, resends rotate tokens without changing consent or retention", async () => {
    const data = input();
    const first = (await service.prepare(data, now))!;
    await service.releaseSend(first.id, first.confirmToken);
    const second = (await service.prepare(
      { ...data, consentVersion: "2" },
      now,
    ))!;
    await service.releaseSend(first.id, first.confirmToken);
    expect(await service.prepare(data, now)).toBeNull();
    expect(await service.confirm(first.confirmToken, now)).toBe(false);
    expect(await service.confirm(second.confirmToken, now)).toBe(true);
    const confirmed = await row(first.id);
    const resend = (await service.prepare(
      data,
      new Date(now.getTime() + 61_000),
    ))!;
    expect(
      await service.confirm(
        resend.confirmToken,
        new Date(now.getTime() + 62_000),
      ),
    ).toBe(true);
    expect(await row(first.id)).toMatchObject({
      consentVersion: "1",
      confirmedAt: confirmed.confirmedAt,
      expiresAt: confirmed.expiresAt,
    });
  });
  test("confirmation expires at 24 hours, consumed confirmation is idempotent", async () => {
    const a = (await service.prepare(input(), now))!;
    expect(
      await service.confirm(a.confirmToken, new Date(now.getTime() + DAY)),
    ).toBe(false);
    const b = (await service.prepare(input(), now))!;
    expect(await service.confirm(b.confirmToken, now)).toBe(true);
    expect(
      await service.confirm(b.confirmToken, new Date(now.getTime() + DAY)),
    ).toBe(true);
    expect((await row(b.id)).expiresAt.getTime()).toBe(
      now.getTime() + 180 * DAY,
    );
  });
  test("verified registration links pre-existing confirmed lead; withdrawal erases inherited source and all personal fields", async () => {
    const data = input();
    const sent = (await service.prepare(data, now))!;
    await service.confirm(sent.confirmToken, now);
    const a = await account(data.email);
    await service.linkRegistration({ ...a, emailVerified: false }, true);
    expect((await row(sent.id)).userId).toBeNull();
    await service.linkRegistration(a, true);
    const store = createAttributionStore(client.db);
    expect(await store.get(a.id)).toMatchObject({
      leadId: sent.id,
      snapshot: source,
    });
    await Promise.all([
      service.linkRegistration(a, true),
      service.withdraw(sent.withdrawToken),
    ]);
    await service.withdraw(sent.withdrawToken);
    expect(await row(sent.id)).toMatchObject({
      status: "withdrawn",
      email: null,
      consentText: null,
      consentVersion: null,
      consentAt: null,
      snapshot: null,
      confirmHash: null,
      withdrawHash: null,
      userId: null,
      linkedAt: null,
    });
    expect((await store.get(a.id))?.snapshot).toBeNull();
    const rejoin = (await service.prepare(data, now))!;
    expect(rejoin.id).not.toBe(sent.id);
  });
  test("late confirmations cannot attribute old accounts and declined source remains absent", async () => {
    const data = input();
    const a = await account(data.email, now);
    const sent = (await service.prepare(data, now))!;
    await service.confirm(sent.confirmToken, new Date(now.getTime() + 1));
    await service.linkRegistration(a, true);
    expect((await row(sent.id)).userId).toBeNull();
    const data2 = input();
    const b = await account(data2.email);
    const sent2 = (await service.prepare(data2, now))!;
    await service.confirm(sent2.confirmToken, now);
    await service.linkRegistration(b, false);
    expect((await row(sent2.id)).userId).toBe(b.id);
    expect(await createAttributionStore(client.db).get(b.id)).toBeNull();
  });
  test("current attribution and withdrawal tombstones take priority over lead fallback", async () => {
    for (const withdrawn of [false, true]) {
      const data = input();
      const sent = (await service.prepare(data, now))!;
      await service.confirm(sent.confirmToken, now);
      const a = await account(data.email);
      const store = createAttributionStore(client.db);
      if (withdrawn) await store.withdraw(a.id);
      else
        await store.freeze(
          a.id,
          { ...source, utm_source: "current" },
          now.getTime(),
        );
      await service.linkRegistration(a, true);
      await service.withdraw(sent.withdrawToken);
      expect((await store.get(a.id))?.snapshot?.utm_source ?? null).toBe(
        withdrawn ? null : "current",
      );
    }
  });
  test("confirmation racing withdrawal cannot resurrect a lead", async () => {
    const sent = (await service.prepare(input(), now))!;
    await Promise.all([
      service.confirm(sent.confirmToken, now),
      service.withdraw(sent.withdrawToken),
    ]);
    expect((await row(sent.id)).status).toBe("withdrawn");
  });
  test("cleanup clears expired pending and confirmed data, inherited source, and preserves live leads", async () => {
    const old = new Date(now.getTime() - 181 * DAY);
    const data = input();
    const expired = (await service.prepare(
      { ...data, snapshot: { ...source, capturedAt: old.getTime() } },
      old,
    ))!;
    await service.confirm(expired.confirmToken, old);
    const a = await account(data.email, new Date(old.getTime() + 1000));
    await service.linkRegistration(a, true, a.createdAt);
    const pending = (await service.prepare(
      input(),
      new Date(now.getTime() - 8 * DAY),
    ))!;
    const live = (await service.prepare(input(), now))!;
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(cleanupLeadsSql, [now]);
    } finally {
      await pool.end();
    }
    expect((await row(expired.id)).email).toBeNull();
    expect((await row(pending.id)).email).toBeNull();
    expect((await row(live.id)).status).toBe("pending");
    expect(
      (await createAttributionStore(client.db).get(a.id))?.snapshot,
    ).toBeNull();
  });
});
