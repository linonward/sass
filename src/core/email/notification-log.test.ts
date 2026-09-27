// @vitest-environment node
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { notificationLog, user } from "@/core/db/schema";

import {
  claimNotification,
  releaseNotificationClaim,
} from "./notification-log";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) console.warn("跳过通知名额测试：未设置 DATABASE_URL_TEST");

const HOUR = 3600 * 1000;
const KIND = "test-notice";

describe.skipIf(!url)("通知名额的占用与释放（真实 Postgres）", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let key: string;

  const claim = (now: Date, windowMs: number | null = null) =>
    claimNotification(db, { kind: KIND, key, userId, windowMs, now });
  const release = (now: Date) =>
    releaseNotificationClaim(db, { kind: KIND, key, now });
  const rows = () =>
    db.select().from(notificationLog).where(eq(notificationLog.userId, userId));

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });
  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    userId = `u_${randomUUID()}`;
    key = `key_${randomUUID()}`;
    await db.insert(user).values({
      id: userId,
      name: "Ada",
      email: `notice-${randomUUID().slice(0, 8)}@example.com`,
    });
  });

  test("发送失败释放名额后，同一 (kind, key) 可以重新占用并补发", async () => {
    const at = new Date("2026-09-25T00:00:00.000Z");

    expect(await claim(at)).toBe(true);
    // 名额被占用：同一个 key 再占一次拿不到（这就是防重复轰炸）。
    expect(await claim(at)).toBe(false);

    // 发送失败 → 释放名额。
    expect(await release(at)).toBe(true);
    expect(await rows()).toHaveLength(0);

    // 重试：重新拿到名额，邮件可以真的发出去。
    expect(await claim(at)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  test("释放只删这次尝试占的行：已被新的发送接管的名额不动", async () => {
    const first = new Date("2026-09-25T00:00:00.000Z");
    const second = new Date(first.getTime() + 2 * HOUR); // 超过窗口，可以再发

    expect(await claim(first, HOUR)).toBe(true);
    expect(await claim(second, HOUR)).toBe(true);

    // 第一次尝试的发送在第二次占名额之后才失败：不能把第二次的名额删掉，否则会重复轰炸。
    expect(await release(first)).toBe(false);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.lastSentAt).toEqual(second);

    // 第二次占的名额仍然有效：窗口内不再发。
    expect(await claim(new Date(second.getTime() + 10 * 60 * 1000), HOUR)).toBe(
      false,
    );
  });

  test("没占过名额或已释放过：释放返回 false", async () => {
    const at = new Date("2026-09-25T00:00:00.000Z");

    expect(await release(at)).toBe(false);

    expect(await claim(at)).toBe(true);
    expect(await release(at)).toBe(true);
    expect(await release(at)).toBe(false);
  });
});
