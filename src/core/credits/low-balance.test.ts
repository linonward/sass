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
import { claimNotification } from "@/core/email/notification-log";
import { sendEmail, type SendEmailOptions } from "@/core/email/send";
import { readLatestEmail } from "@/core/email/testing";

import siteConfig from "../../../site.config";
import { CreditsDisabledError } from "./errors";
import { createLowBalanceHook } from "./low-balance";
import { createCredits, type AfterCommitCallback } from "./service";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) console.warn("跳过 credits-low 测试：未设置 DATABASE_URL_TEST");

const HOUR = 3600 * 1000;
const THRESHOLD = 100;

describe.skipIf(!url)("credits-low 提醒（真实 Postgres）", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let email: string;
  let clock: Date;
  let failSend: boolean;
  const sent: SendEmailOptions<"credits-low">[] = [];
  let seq = 0;

  const capture = async (message: SendEmailOptions<"credits-low">) => {
    if (failSend) throw new Error("SMTP down");
    sent.push(message);
  };

  const credits = (
    options: { enabled?: boolean; send?: typeof capture } = {},
  ) =>
    createCredits({
      db,
      enabled: options.enabled ?? true,
      lowBalance: createLowBalanceHook({
        threshold: THRESHOLD,
        send: options.send ?? capture,
        now: () => clock,
      }),
    });

  const grant = (amount: number) =>
    credits().grantCredits({
      userId,
      amount,
      source: "test",
      sourceId: `g_${++seq}_${randomUUID()}`,
    });
  const deduct = (amount: number, c = credits()) =>
    c.deductCredits({
      userId,
      amount,
      source: "test",
      sourceId: `d_${++seq}_${randomUUID()}`,
    });

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });
  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    failSend = false;
    clock = new Date("2026-09-25T00:00:00.000Z");
    userId = `u_${randomUUID()}`;
    email = `low-${randomUUID().slice(0, 8)}@example.com`;
    await db
      .insert(user)
      .values({ id: userId, name: "Ada", email, emailVerified: true });
  });

  test("跨过阈值时发一封；阈值以下继续扣减不再发", async () => {
    await grant(150);
    await deduct(30); // 150 → 120
    expect(sent).toHaveLength(0);
    await deduct(30); // 120 → 90，跨过 100
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: email,
      template: "credits-low",
      locale: "en",
      props: {
        balance: 90,
        threshold: THRESHOLD,
        topUpUrl: `https://${siteConfig.domain}/pricing`,
      },
    });
    await deduct(10); // 90 → 80
    await deduct(80); // 80 → 0
    expect(sent).toHaveLength(1);
  });

  test("正好扣到阈值不提醒，低于阈值才提醒", async () => {
    await grant(150);
    await deduct(50); // → 100
    expect(sent).toHaveLength(0);
    await deduct(1); // → 99
    expect(sent).toHaveLength(1);
  });

  test("24 小时内再次跨过阈值不发，超过 24 小时会再发", async () => {
    await grant(150);
    await deduct(60); // → 90，发第一封
    expect(sent).toHaveLength(1);

    clock = new Date(clock.getTime() + 23 * HOUR);
    await grant(100); // → 190
    await deduct(100); // → 90，23 小时后再次跨过
    expect(sent).toHaveLength(1);

    clock = new Date(clock.getTime() + 2 * HOUR); // 距第一封 25 小时
    await grant(100); // → 190
    await deduct(100); // → 90
    expect(sent).toHaveLength(2);
  });

  test("50 个并发扣减只发一封，余额和流水一致", async () => {
    await grant(1040);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => deduct(20)),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await credits().getBalance(userId)).toBe(40);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.props.balance).toBeLessThan(THRESHOLD);
  });

  test("去重名额并发抢占时只有一个成功", async () => {
    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimNotification(db, {
          kind: "credits-low",
          key: userId,
          userId,
          windowMs: 24 * HOUR,
          now: clock,
        }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  test("features.credits 关闭时扣减报错，不发信", async () => {
    await expect(deduct(10, credits({ enabled: false }))).rejects.toThrow(
      CreditsDisabledError,
    );
    expect(sent).toHaveLength(0);
  });

  test("发信失败不影响扣减", async () => {
    await grant(150);
    failSend = true;
    const result = await deduct(60);
    expect(result).toMatchObject({ status: "applied", balance: 90 });
  });

  test("外部事务：提交后由调用方的 afterCommit 发送；回滚时不发且名额回滚", async () => {
    await grant(150);
    const c = credits();

    // 回滚
    const rolledBack: AfterCommitCallback[] = [];
    await expect(
      db.transaction(async (tx) => {
        await c.deductCredits(
          {
            userId,
            amount: 60,
            source: "test",
            sourceId: `rb_${randomUUID()}`,
          },
          { tx, afterCommit: (fn) => rolledBack.push(fn) },
        );
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect(sent).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.userId, userId)),
    ).toHaveLength(0);

    // 提交：回调由调用方在提交后执行
    const committed: AfterCommitCallback[] = [];
    await db.transaction(async (tx) => {
      await c.deductCredits(
        { userId, amount: 60, source: "test", sourceId: `ok_${randomUUID()}` },
        { tx, afterCommit: (fn) => committed.push(fn) },
      );
    });
    expect(sent).toHaveLength(0);
    for (const fn of committed) await fn();
    expect(sent).toHaveLength(1);
  });

  test("外部事务但没传 afterCommit：跳过提醒，也不占用名额", async () => {
    await grant(150);
    await db.transaction(async (tx) => {
      await credits().deductCredits(
        { userId, amount: 60, source: "test", sourceId: `nt_${randomUUID()}` },
        { tx },
      );
    });
    expect(sent).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.userId, userId)),
    ).toHaveLength(0);
  });

  test("EMAIL_TRANSPORT=file：真实渲染并写入发件箱", async () => {
    const previous = process.env.EMAIL_TRANSPORT;
    process.env.EMAIL_TRANSPORT = "file";
    try {
      await grant(150);
      const since = new Date();
      await deduct(60, credits({ send: sendEmail as never }));
      const stored = await readLatestEmail({
        to: email,
        template: "credits-low",
        since,
      });
      expect(stored?.subject).toContain("running low on credits");
      expect(stored?.text).toContain("90 credits");
    } finally {
      process.env.EMAIL_TRANSPORT = previous;
    }
  });
});
